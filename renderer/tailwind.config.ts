import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(214 32% 91%)",
        background: "hsl(220 20% 97%)",
        foreground: "hsl(222 47% 11%)",
        card: "hsl(0 0% 100%)",
        primary: "hsl(0 100% 71%)",
        "primary-foreground": "hsl(0 0% 100%)",
        muted: "hsl(220 14% 96%)",
        "muted-foreground": "hsl(220 9% 46%)"
      },
      borderRadius: {
        lg: "0.75rem",
        md: "0.5rem",
        sm: "0.375rem"
      }
    }
  },
  plugins: []
};

export default config;
