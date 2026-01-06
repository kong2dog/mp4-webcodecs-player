/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{vue,js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        "player-bg": "#0f0f0f",
        "player-control": "rgba(255, 255, 255, 0.1)",
        "player-accent": "#3b82f6",
      },
    },
  },
  plugins: [],
};
