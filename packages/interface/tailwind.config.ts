import type { Config } from "tailwindcss";

export default {
  content: ["./src/renderer/**/*.{ts,tsx,html}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "monospace"],
      },
      colors: {
        neutral: {
          50: "#fafaf9",
          100: "#f5f5f4",
          200: "#e7e5e4",
          300: "#d6d3d1",
          500: "#78716c",
          600: "#57534e",
          700: "#44403c",
          900: "#1c1917",
        },
        ok: { 500: "#16a34a", 600: "#15803d" },
        warn: { 500: "#f59e0b", 600: "#d97706" },
        bad: { 500: "#ef4444", 600: "#dc2626" },
      },
    },
  },
  plugins: [],
} satisfies Config;
