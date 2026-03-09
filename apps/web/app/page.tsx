export default function HomePage() {
  return (
    <main style={{ minHeight: "100vh", padding: "4rem 1.5rem", display: "grid", placeItems: "center" }}>
      <section style={{ maxWidth: 880, width: "100%", background: "rgba(15, 23, 42, 0.82)", border: "1px solid rgba(148, 163, 184, 0.2)", borderRadius: 24, padding: "2rem" }}>
        <p style={{ margin: 0, letterSpacing: "0.2em", textTransform: "uppercase", color: "#38bdf8", fontSize: 12 }}>MX402 Exchange</p>
        <h1 style={{ marginTop: 16, marginBottom: 16, fontSize: "clamp(2.5rem, 8vw, 5rem)", lineHeight: 1 }}>Pay-per-API on MultiversX</h1>
        <p style={{ maxWidth: 640, fontSize: 18, lineHeight: 1.6, color: "#cbd5e1" }}>
          This workspace is scaffolded for the v1 marketplace, ledger, gateway, and settlement flow. The next implementation target is buyer deposits, mirrored balances, and the first paid API call through the gateway.
        </p>
      </section>
    </main>
  );
}
