import NewsSection from "@/components/NewsSection";
import ChatHero from "@/components/ChatHero";
import RecentResearch from "@/components/RecentResearch";

export default function Home() {
  return (
    <main id="main-content" className="home-shell">
      <NewsSection />
      <ChatHero />
      <RecentResearch />
    </main>
  );
}
