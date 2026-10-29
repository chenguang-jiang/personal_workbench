import { DawnLogo } from "@/components/brand/DawnLogo";

export default function ShareNotFound() {
  return (
    <section className="share-page share-page--missing">
      <div className="share-missing-card">
        <div className="share-logo" aria-hidden="true">
          <DawnLogo />
        </div>
        <h1>分享不存在或已关闭</h1>
        <p>这个链接可能已被作者取消分享，请向对方确认最新链接。</p>
      </div>
    </section>
  );
}
