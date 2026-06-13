"use client";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b1220",
          color: "#e2e8f0",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 420 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Something went wrong</h1>
          <p style={{ color: "#94a3b8", marginTop: 8 }}>
            KarbonCopy hit an unexpected error. Your data is safe.
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: 16,
              padding: "8px 16px",
              borderRadius: 8,
              background: "#2563eb",
              color: "#fff",
              border: 0,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
