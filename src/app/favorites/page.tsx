import { ReadingLibrary } from "@/components/reading/ReadingLibrary";

export const metadata = {
  title: "收藏夹",
};

export default function FavoritesPage() {
  return <ReadingLibrary favoritesOnly />;
}
