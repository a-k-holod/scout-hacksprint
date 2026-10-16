import { SearchPanel } from "@/components/search-panel";

export default function Home() {
  return (
    <main className="page">
      <header className="masthead">
        <h1>Scout</h1>
        <p className="subtitle">Research the web. See the evidence.</p>
      </header>
      <SearchPanel />
    </main>
  );
}
