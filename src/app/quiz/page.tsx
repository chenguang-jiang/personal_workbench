"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlarmClock,
  Bell,
  BellOff,
  BookMarked,
  BookOpen,
  CheckCircle2,
  ChevronUp,
  RefreshCcw,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useUiPrefs } from "@/lib/ui-prefs";
import { renderInlineMarkdown, renderMiniMarkdown } from "@/lib/mini-markdown";

interface QuizListItem {
  day: string;
  status: string;
  completedAt: string | null;
  nudgeDue: boolean;
  nudgeStage: number;
  isToday: boolean;
  isOverdue: boolean;
}

interface QuizOption {
  key: string;
  text: string;
}

type QuizQuestionType = "single" | "multi" | "essay";

interface QuizQuestion {
  index: number;
  title: string;
  stem: string;
  options: QuizOption[];
  answer: string;
  explanation: string;
  type: QuizQuestionType;
}

interface QuizSet {
  day: string;
  title: string;
  intro: string;
  questions: QuizQuestion[];
}

interface QuizState {
  status: string;
  reminderStage: number;
}

interface QuizAnswerRow {
  qIndex: number;
  choice: string;
  correct: boolean;
}

interface Nudge {
  stage: number;
  due: boolean;
  message: string;
}

interface WrongItem {
  setId: string;
  qIndex: number;
  createdAt: string;
  setTitle: string;
  question: QuizQuestion;
}

export default function QuizPage() {
  const { t } = useUiPrefs();
  const [items, setItems] = useState<QuizListItem[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [set, setSet] = useState<QuizSet | null>(null);
  const [state, setState] = useState<QuizState | null>(null);
  const [answers, setAnswers] = useState<QuizAnswerRow[]>([]);
  const [picks, setPicks] = useState<Record<number, string[]>>({});
  const [essayDrafts, setEssayDrafts] = useState<Record<number, string>>({});
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  const [nudge, setNudge] = useState<Nudge | null>(null);
  const [wrong, setWrong] = useState<Record<string, number[]>>({});
  const [wrongView, setWrongView] = useState(false);
  const [wrongItems, setWrongItems] = useState<WrongItem[] | null>(null);
  const [wrongTotal, setWrongTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notify, setNotify] = useState<
    "default" | "granted" | "denied" | "unsupported"
  >("default");
  const questionsRef = useRef<HTMLDivElement>(null);
  const lastNotifiedStage = useRef<number>(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setNotify(
        typeof Notification !== "undefined"
          ? Notification.permission
          : "unsupported",
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const loadList = useCallback(async () => {
    const response = await fetch("/api/quiz");
    if (!response.ok) return;
    const data = await response.json();
    setItems(data.items ?? []);
    return data.items as QuizListItem[];
  }, []);

  const loadDay = useCallback(async (day: string) => {
    const response = await fetch(`/api/quiz/${day}`);
    if (!response.ok) return;
    const data = await response.json();
    setSet(data.set);
    setState(data.state);
    setAnswers(data.answers ?? []);
    setNudge(data.nudge);
    setWrong((current) => ({ ...current, [day]: data.wrong ?? [] }));
  }, []);

  const loadWrongList = useCallback(async () => {
    const response = await fetch("/api/quiz/wrong");
    if (!response.ok) return;
    const data = await response.json();
    const items = (data.items ?? []) as WrongItem[];
    setWrongItems(items);
    setWrongTotal(items.length);
  }, []);

  useEffect(() => {
    void (async () => {
      const list = await loadList();
      const today = list?.find((item) => item.isToday) ?? list?.[0];
      if (today) {
        setSelected(today.day);
        await loadDay(today.day);
      }
      await loadWrongList();
      setLoading(false);
    })();
  }, [loadList, loadDay, loadWrongList]);

  // 每 30 秒刷新提醒状态
  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadList();
      if (selected) void loadDay(selected);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [loadList, loadDay, selected]);

  // 到点提醒：横幅 + 可选系统通知
  useEffect(() => {
    if (!nudge?.due) return;
    if (notify === "granted" && nudge.stage > lastNotifiedStage.current) {
      lastNotifiedStage.current = nudge.stage;
      try {
        new Notification("题库机提醒", { body: nudge.message });
      } catch {
        // 忽略系统通知失败
      }
    }
  }, [nudge, notify]);

  async function post(
    action: string,
    extra: Record<string, unknown> = {},
    day: string = selected,
  ) {
    if (!day) return;
    const response = await fetch(`/api/quiz/${day}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    if (!response.ok) return;
    const data = await response.json();
    if (day === selected) {
      if (data.state) setState(data.state);
      if (data.answers) setAnswers(data.answers);
      if (data.nudge) setNudge(data.nudge);
      if (data.wrong) setWrong((current) => ({ ...current, [day]: data.wrong }));
    }
    void loadList();
  }

  async function toggleWrong(question: QuizQuestion) {
    if (!selected) return;
    const list = wrong[selected] ?? [];
    const on = !list.includes(question.index);
    setWrong((current) => ({
      ...current,
      [selected]: on
        ? [...(current[selected] ?? []), question.index]
        : (current[selected] ?? []).filter((i) => i !== question.index),
    }));
    const response = await fetch(`/api/quiz/${selected}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "wrong", qIndex: question.index, on }),
    });
    if (!response.ok) {
      setWrong((current) => ({ ...current, [selected]: list }));
      return;
    }
    setWrongTotal((count) => Math.max(0, count + (on ? 1 : -1)));
  }

  async function removeWrong(item: WrongItem) {
    const response = await fetch(`/api/quiz/${item.setId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "wrong", qIndex: item.qIndex, on: false }),
    });
    if (!response.ok) return;
    setWrong((current) => ({
      ...current,
      [item.setId]: (current[item.setId] ?? []).filter(
        (i) => i !== item.qIndex,
      ),
    }));
    void loadWrongList();
  }

  async function enableNotify() {
    if (typeof Notification === "undefined") return;
    const permission = await Notification.requestPermission();
    setNotify(permission);
  }

  function clickOption(question: QuizQuestion, key: string) {
    if (question.type === "single") {
      void post("answer", { qIndex: question.index, choice: key });
      return;
    }
    setPicks((current) => {
      const list = current[question.index] ?? [];
      const next = list.includes(key)
        ? list.filter((item) => item !== key)
        : [...list, key];
      return { ...current, [question.index]: next };
    });
  }

  function submitMulti(question: QuizQuestion) {
    const choice = (picks[question.index] ?? []).slice().sort().join("");
    if (!choice) return;
    setPicks((current) => {
      const next = { ...current };
      delete next[question.index];
      return next;
    });
    void post("answer", { qIndex: question.index, choice });
  }

  function submitEssay(question: QuizQuestion) {
    const mine = (essayDrafts[question.index] ?? "").trim();
    if (!mine) return;
    void post("answer", { qIndex: question.index, mine });
  }

  const answerMap = useMemo(() => {
    const map = new Map<number, QuizAnswerRow>();
    for (const row of answers) map.set(row.qIndex, row);
    return map;
  }, [answers]);

  const doneItems = useMemo(() => items.filter((item) => item.status === "done"), [items]);
  const todoItems = useMemo(() => items.filter((item) => item.status !== "done"), [items]);

  const correctCount = answers.filter(
    (row) => row.correct && revealed[row.qIndex],
  ).length;
  const wrongCount = answers.filter(
    (row) => !row.correct && revealed[row.qIndex],
  ).length;
  const answeredCount = answers.length;
  const revealedCount = answers.filter((row) => revealed[row.qIndex]).length;
  const total = set?.questions.length ?? 0;

  function renderDayButton(item: QuizListItem) {
    const done = item.status === "done";
    return (
      <div className="quiz-day-row" key={item.day}>
        <button
          type="button"
          className={
            selected === item.day
              ? `quiz-day quiz-day--active ${done ? "quiz-day--done" : "quiz-day--todo"}`
              : done
                ? "quiz-day quiz-day--done"
                : "quiz-day quiz-day--todo"
          }
          onClick={() => {
            setSelected(item.day);
            setRevealed({});
            void loadDay(item.day);
          }}
        >
          <span
            className={
              done ? "quiz-day-dot quiz-day-dot--done" : "quiz-day-dot quiz-day-dot--todo"
            }
          />
          <strong>{item.day.slice(5).replace("-", "/")}</strong>
          <small>
            {item.isToday
              ? "今天"
              : done
                ? "已完成"
                : item.isOverdue
                  ? "欠账"
                  : "待做"}
          </small>
          {item.nudgeDue && item.isToday && (
            <em className="quiz-day-nudge">!</em>
          )}
        </button>
        <button
          type="button"
          className="quiz-day-toggle"
          title={done ? "标记未完成" : "标记完成"}
          aria-label={done ? "标记未完成" : "标记完成"}
          onClick={() =>
            void post("status", { status: done ? "pending" : "done" }, item.day)
          }
        >
          {done ? <RotateCcw aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
        </button>
      </div>
    );
  }

  return (
    <div className="quiz-page">
      <section className="panel quiz-side">
        <div className="panel-heading">
          <div>
            <p className="micro-label">DAILY DRILL</p>
            <h2>{t("quiz_title")}</h2>
          </div>
          <button
            type="button"
            className="quiz-notify"
            title={
              notify === "granted" ? t("quiz_notify_on") : t("quiz_notify_off")
            }
            onClick={() =>
              void (notify === "granted" ? undefined : enableNotify())
            }
          >
            {notify === "granted" ? (
              <Bell aria-hidden="true" />
            ) : (
              <BellOff aria-hidden="true" />
            )}
          </button>
        </div>
        <button
          type="button"
          className={
            wrongView ? "quiz-wrong-entry quiz-wrong-entry--active" : "quiz-wrong-entry"
          }
          onClick={() => {
            const next = !wrongView;
            setWrongView(next);
            if (next) void loadWrongList();
          }}
        >
          <BookMarked aria-hidden="true" />
          错题本
          {wrongTotal > 0 && <span>{wrongTotal}</span>}
        </button>
        <div className="quiz-days">
          <div className="quiz-day-group">
            <p className="quiz-day-group-title">
              未完成 <span>{todoItems.length}</span>
            </p>
            {todoItems.length === 0 && (
              <p className="quiz-day-group-empty">全部完成，今天没有欠账。</p>
            )}
            {todoItems.map((item) => renderDayButton(item))}
          </div>
          <div className="quiz-day-group">
            <p className="quiz-day-group-title">
              已完成 <span>{doneItems.length}</span>
            </p>
            {doneItems.length === 0 && (
              <p className="quiz-day-group-empty">还没有完成的题集。</p>
            )}
            {doneItems.map((item) => renderDayButton(item))}
          </div>
        </div>
        <p className="quiz-legend">
          <i className="quiz-day-dot quiz-day-dot--todo" /> 未完成
          <i className="quiz-day-dot quiz-day-dot--done" /> 已完成
        </p>
        <p className="quiz-rule">
          <AlarmClock aria-hidden="true" />
          提醒节奏：送达 3h → 2h → 1h → 30min，间隔越来越短，话越来越狠。
        </p>
      </section>

      <section className="quiz-main">
        {wrongView ? (
          <div className="quiz-wrong-view">
            <header className="quiz-head">
              <div>
                <p className="micro-label">WRONG BOOK</p>
                <h2>错题本</h2>
              </div>
              <div className="quiz-head-side">
                <span className="quiz-wrong-count">
                  共 {wrongItems?.length ?? 0} 题
                </span>
              </div>
            </header>
            {!wrongItems || wrongItems.length === 0 ? (
              <div className="quiz-empty">
                <strong>错题本是空的</strong>
                <span>
                  做题时点题目右上角「错题本」即可收录，方便反复重练。
                </span>
              </div>
            ) : (
              <div className="quiz-questions">
                {wrongItems.map((item) => (
                  <article
                    key={`${item.setId}-${item.qIndex}`}
                    className="quiz-card quiz-card--wrong"
                  >
                    <div className="quiz-card-head">
                      <span className="quiz-card-no">
                        {item.setId.slice(5).replace("-", "/")} · 第{" "}
                        {item.question.index + 1} 题
                      </span>
                      <span className="quiz-type-chip">
                        {item.question.type === "single"
                          ? "单选题"
                          : item.question.type === "multi"
                            ? "多选题"
                            : "案例问答题"}
                      </span>
                      <span className="quiz-card-title">
                        {item.question.title}
                      </span>
                      <button
                        type="button"
                        className="quiz-wrong-remove"
                        title="从错题本移除"
                        onClick={() => void removeWrong(item)}
                      >
                        <Trash2 aria-hidden="true" /> 移除
                      </button>
                    </div>
                    <div
                      className="quiz-stem"
                      dangerouslySetInnerHTML={{
                        __html: renderMiniMarkdown(item.question.stem),
                      }}
                    />
                    {item.question.options.length > 0 && (
                      <div className="quiz-options">
                        {item.question.options.map((option) => (
                          <div
                            key={option.key}
                            className="quiz-option quiz-option--static"
                          >
                            <span className="quiz-option-key">
                              {option.key}
                            </span>
                            <span
                              dangerouslySetInnerHTML={{
                                __html: renderInlineMarkdown(option.text),
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="quiz-explain quiz-explain--right">
                      <strong>答案：{item.question.answer}</strong>
                      <div
                        className="quiz-explain-body"
                        dangerouslySetInnerHTML={{
                          __html: renderMiniMarkdown(
                            item.question.explanation || "（本题暂无解析）",
                          ),
                        }}
                      />
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
          {nudge?.due && state?.status !== "done" && (
          <div
            className={`quiz-nudge quiz-nudge--stage-${Math.min(nudge.stage, 4)}`}
          >
            <strong>第 {nudge.stage} 次提醒</strong>
            <p>{nudge.message}</p>
            <div className="quiz-nudge-actions">
              <button
                type="button"
                onClick={() => {
                  questionsRef.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                  });
                  void post("nudge");
                }}
              >
                去做题
              </button>
              <button type="button" onClick={() => void post("nudge")}>
                稍后提醒
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="quiz-loading">正在读取今日题集…</div>
        ) : !set ? (
          <div className="quiz-empty">
            <strong>今天还没有题集送达</strong>
            <span>
              等 agent 把题推进 Obsidian 的「每日题库」后，这里会自动亮起来。
            </span>
          </div>
        ) : (
          <>
            <header className="quiz-head">
              <div>
                <p className="micro-label">{set.day}</p>
                <h2>{set.title}</h2>
                {set.intro && (
                  <p
                    className="quiz-intro"
                    dangerouslySetInnerHTML={{
                      __html: renderInlineMarkdown(set.intro),
                    }}
                  />
                )}
              </div>
              <div className="quiz-head-side">
                <div className="quiz-progress-line">
                  <span>
                    已答 {answeredCount} / {total}
                    {answeredCount > 0 && revealedCount === 0 && (
                      <em> · 查看解析后核对</em>
                    )}
                    {revealedCount > 0 && (
                      <>
                        {" "}
                        · 对 {correctCount}
                        {wrongCount > 0 && <em> · 错 {wrongCount}</em>}
                      </>
                    )}
                  </span>
                  <div className="quiz-progress-bar">
                    <i
                      style={{
                        width: `${total ? (answeredCount / total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
                <div className="quiz-head-actions">
                  {wrongCount > 0 && (
                    <button
                      type="button"
                      onClick={() => void post("retry")}
                      title="清掉错误答案，重新作答"
                    >
                      <RefreshCcw aria-hidden="true" /> 重做错题
                    </button>
                  )}
                  {state?.status === "done" ? (
                    <button
                      type="button"
                      onClick={() => void post("status", { status: "pending" })}
                    >
                      <RotateCcw aria-hidden="true" /> 标记未完成
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="quiz-mark-done"
                      onClick={() => void post("status", { status: "done" })}
                    >
                      <CheckCircle2 aria-hidden="true" /> 标记完成
                    </button>
                  )}
                </div>
              </div>
            </header>

            <div className="quiz-questions" ref={questionsRef}>
              {set.questions.map((question) => {
                const row = answerMap.get(question.index);
                const answered = Boolean(row);
                const isEssay = question.type === "essay";
                const isOpen = Boolean(revealed[question.index]);
                const pickedCount = picks[question.index]?.length ?? 0;
                const essayDraft = (essayDrafts[question.index] ?? "").trim();
                return (
                  <article key={question.index} className="quiz-card">
                    <div className="quiz-card-head">
                      <span className="quiz-card-no">
                        第 {question.index + 1} 题
                      </span>
                      <span className="quiz-type-chip">
                        {question.type === "single"
                          ? "单选题"
                          : question.type === "multi"
                            ? "多选题"
                            : "案例问答题"}
                      </span>
                      <span className="quiz-card-title">{question.title}</span>
                      <button
                        type="button"
                        className={
                          (wrong[selected] ?? []).includes(question.index)
                            ? "quiz-wrong-btn quiz-wrong-btn--on"
                            : "quiz-wrong-btn"
                        }
                        title={
                          (wrong[selected] ?? []).includes(question.index)
                            ? "从错题本移除"
                            : "加入错题本"
                        }
                        onClick={() => void toggleWrong(question)}
                      >
                        <BookMarked aria-hidden="true" />
                        {(wrong[selected] ?? []).includes(question.index)
                          ? "已收录"
                          : "错题本"}
                      </button>
                      {answered &&
                        (isEssay || !isOpen ? (
                          <span className="quiz-result quiz-result--self">
                            已作答
                          </span>
                        ) : row?.correct ? (
                          <span className="quiz-result quiz-result--right">
                            回答正确
                          </span>
                        ) : (
                          <span className="quiz-result quiz-result--wrong">
                            回答错误
                          </span>
                        ))}
                    </div>
                    <div
                      className="quiz-stem"
                      dangerouslySetInnerHTML={{
                        __html: renderMiniMarkdown(question.stem),
                      }}
                    />
                    <p className="quiz-hint">
                      {answered
                        ? !isOpen
                          ? "已提交作答，点击「查看解析」核对答案与解析。"
                          : isEssay
                            ? "已提交作答，以下为参考答案，请对照自查。"
                            : `你的答案：${row?.choice} · 正确答案：${question.answer}`
                        : question.type === "single"
                          ? "单选题：请从下列选项中选出最恰当的一项，点击选项即提交。"
                          : question.type === "multi"
                            ? `多选题：请选出所有正确选项后点击“提交答案”。${pickedCount > 0 ? `（已选 ${pickedCount} 项）` : ""}`
                            : "案例问答题：请在下方作答区书写你的答案，提交后对照参考答案。"}
                    </p>
                    {!isEssay && (
                      <div className="quiz-options">
                        {question.options.map((option) => {
                          const isPick = row?.choice.includes(option.key);
                          const isCorrectKey = question.answer.includes(
                            option.key,
                          );
                          const isPicked =
                            !answered &&
                            (picks[question.index] ?? []).includes(option.key);
                          let cls = "quiz-option";
                          if (question.type === "multi")
                            cls += " quiz-option--multi";
                          if (isPicked) cls += " quiz-option--picked";
                          if (answered && !isOpen && isPick)
                            cls += " quiz-option--mine";
                          if (answered && isOpen && isPick && row?.correct)
                            cls += " quiz-option--correct";
                          else if (answered && isOpen && isPick && !row?.correct)
                            cls += " quiz-option--wrong";
                          else if (
                            answered &&
                            isOpen &&
                            !row?.correct &&
                            isCorrectKey
                          )
                            cls += " quiz-option--reveal";
                          return (
                            <button
                              key={option.key}
                              type="button"
                              className={cls}
                              disabled={answered}
                              onClick={() => clickOption(question, option.key)}
                            >
                              <span className="quiz-option-key">
                                {option.key}
                              </span>
                              <span
                                dangerouslySetInnerHTML={{
                                  __html: renderInlineMarkdown(option.text),
                                }}
                              />
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {isEssay && !answered && (
                      <div className="quiz-essay">
                        <textarea
                          rows={5}
                          placeholder="请在此书写你的作答要点…"
                          value={essayDrafts[question.index] ?? ""}
                          onChange={(event) =>
                            setEssayDrafts((current) => ({
                              ...current,
                              [question.index]: event.target.value,
                            }))
                          }
                        />
                      </div>
                    )}
                    {((question.type === "multi" && !answered) ||
                      (isEssay && !answered)) && (
                      <div className="quiz-multi-foot">
                        <button
                          type="button"
                          className="quiz-submit"
                          disabled={
                            question.type === "multi"
                              ? pickedCount === 0
                              : essayDraft.length === 0
                          }
                          onClick={() =>
                            question.type === "multi"
                              ? submitMulti(question)
                              : submitEssay(question)
                          }
                        >
                          提交答案
                        </button>
                        {question.type === "multi" && (
                          <button
                            type="button"
                            className="quiz-clear"
                            disabled={pickedCount === 0}
                            onClick={() =>
                              setPicks((current) => ({
                                ...current,
                                [question.index]: [],
                              }))
                            }
                          >
                            清空
                          </button>
                        )}
                      </div>
                    )}
                    {answered && (
                      <div className="quiz-reveal">
                        <button
                          type="button"
                          className={
                            isOpen
                              ? "quiz-reveal-btn quiz-reveal-btn--open"
                              : "quiz-reveal-btn"
                          }
                          aria-expanded={isOpen}
                          onClick={() =>
                            setRevealed((current) => ({
                              ...current,
                              [question.index]: !isOpen,
                            }))
                          }
                        >
                          {isOpen ? (
                            <ChevronUp aria-hidden="true" />
                          ) : (
                            <BookOpen aria-hidden="true" />
                          )}
                          {isOpen ? "收起解析" : "查看解析"}
                        </button>
                        {isOpen && (
                          <div
                            className={
                              row?.correct
                                ? "quiz-explain quiz-explain--right"
                                : "quiz-explain"
                            }
                          >
                            {!isEssay && (
                              <strong>答案：{question.answer}</strong>
                            )}
                            <div
                              className="quiz-explain-body"
                              dangerouslySetInnerHTML={{
                                __html: renderMiniMarkdown(
                                  question.explanation || "（本题暂无解析）",
                                ),
                              }}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </>
        )}
          </>
        )}
      </section>
    </div>
  );
}
