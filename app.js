// Theme Toggle Logic (Dark/Light Mode)
const themeToggleBtn = document.getElementById("themeToggleBtn");
const bodyElement = document.body;

// লোকাল স্টোরেজ থেকে সেভ করা থিম লোড করা
const savedTheme = localStorage.getItem("appTheme") || "dark-theme";
bodyElement.className = savedTheme;
updateThemeIcon(savedTheme);

if (themeToggleBtn) {
  themeToggleBtn.addEventListener("click", () => {
    if (bodyElement.classList.contains("dark-theme")) {
      bodyElement.classList.replace("dark-theme", "light-theme");
      localStorage.setItem("appTheme", "light-theme");
      updateThemeIcon("light-theme");
    } else {
      bodyElement.classList.replace("light-theme", "dark-theme");
      localStorage.setItem("appTheme", "dark-theme");
      updateThemeIcon("dark-theme");
    }
  });
}

function updateThemeIcon(theme) {
  if (!themeToggleBtn) return;
  const icon = themeToggleBtn.querySelector("i");
  if (icon) {
    if (theme === "light-theme") {
      icon.className = "fa-solid fa-sun";
    } else {
      icon.className = "fa-solid fa-moon";
    }
  }
}
