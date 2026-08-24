import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "./hooks/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#051424",
          dim: "#051424",
          bright: "#2c3a4c",
          "container-lowest": "#010f1f",
          "container-low": "#0d1c2d",
          container: "#122131",
          "container-high": "#1c2b3c",
          "container-highest": "#273647",
        },
        "on-surface": "#d4e4fa",
        "on-surface-variant": "#bec7d4",
        "inverse-surface": "#d4e4fa",
        "inverse-on-surface": "#233143",
        outline: "#88919d",
        "outline-variant": "#3f4852",
        primary: {
          DEFAULT: "#98cbff",
          on: "#003354",
          container: "#00a3ff",
          "on-container": "#00375a",
        },
        secondary: {
          DEFAULT: "#4edea3",
          on: "#003824",
          container: "#00a572",
          "on-container": "#00311f",
        },
        tertiary: {
          DEFAULT: "#ffb95f",
          on: "#472a00",
          container: "#da8b00",
          "on-container": "#4c2d00",
        },
        error: {
          DEFAULT: "#ffb4ab",
          on: "#690005",
          container: "#93000a",
          "on-container": "#ffdad6",
        },
        appeal: {
          DEFAULT: "#c4a3ff",
          on: "#3a1e73",
          container: "#5a3fa0",
        },
        background: "#051424",
        "on-background": "#d4e4fa",
        "surface-variant": "#273647",
      },
      fontFamily: {
        sans: ["var(--font-geist)", "Geist", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains-mono)", "JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: {
        "display-lg": ["48px", { lineHeight: "56px", letterSpacing: "-0.02em", fontWeight: "700" }],
        "headline-lg": ["32px", { lineHeight: "40px", letterSpacing: "-0.01em", fontWeight: "600" }],
        "headline-md": ["24px", { lineHeight: "32px", fontWeight: "600" }],
        "headline-sm": ["20px", { lineHeight: "28px", fontWeight: "600" }],
        "body-lg": ["18px", { lineHeight: "28px", fontWeight: "400" }],
        "body-md": ["16px", { lineHeight: "24px", fontWeight: "400" }],
        "body-sm": ["14px", { lineHeight: "20px", fontWeight: "400" }],
        "label-md": ["12px", { lineHeight: "16px", letterSpacing: "0.05em", fontWeight: "500" }],
        "label-sm": ["10px", { lineHeight: "14px", letterSpacing: "0.05em", fontWeight: "500" }],
      },
      borderRadius: {
        sm: "0.125rem",
        DEFAULT: "0.25rem",
        md: "0.375rem",
        lg: "0.5rem",
        xl: "0.75rem",
        full: "9999px",
      },
      spacing: {
        gutter: "16px",
        section: "48px",
      },
      backdropBlur: {
        glass: "12px",
      },
    },
  },
  plugins: [],
};

export default config;
