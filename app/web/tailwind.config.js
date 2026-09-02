export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0E1526",
        sub: "#5A6474",
        faint: "#98A1B2",
        line: "#E9EDF4",
        paper: "#F7F9FC",
        accent: "#6FA8F5",
        accentDeep: "#2F6FD0",
        accentSoft: "#EAF2FE",
        ok: "#4FB07E",
        okSoft: "#E9F6EF",
        warn: "#E0A93C",
        warnSoft: "#FBF3E2",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "monospace"],
      },
      boxShadow: {
        float: "0 24px 50px -22px rgba(30,55,100,.30)",
        soft: "0 8px 26px -18px rgba(30,55,100,.22)",
      },
    },
  },
  plugins: [],
};
