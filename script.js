const menuToggle = document.querySelector(".menu-toggle");
const siteNav = document.querySelector("#site-nav");
const mobileLayout = window.matchMedia("(max-width: 850px)");

menuToggle.hidden = false;

function closeMenu(restoreFocus = false) {
  menuToggle.setAttribute("aria-expanded", "false");

  if (restoreFocus) {
    menuToggle.focus();
  }
}

menuToggle.addEventListener("click", () => {
  const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
  menuToggle.setAttribute("aria-expanded", String(!isOpen));
});

siteNav.addEventListener("click", (event) => {
  if (event.target.closest("a") && mobileLayout.matches) {
    closeMenu();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && menuToggle.getAttribute("aria-expanded") === "true") {
    closeMenu(true);
  }
});

mobileLayout.addEventListener("change", () => closeMenu());

document.querySelectorAll("[data-load-embed]").forEach((button) => {
  const panel = document.getElementById(button.getAttribute("aria-controls"));
  button.hidden = false;
  button.setAttribute("aria-expanded", "false");

  button.addEventListener("click", () => {
    const show = panel.hidden;
    const label = panel.id === "map-embed" ? "map" : "calendar";

    if (show && !panel.firstElementChild) {
      const frame = document.createElement("iframe");
      frame.src = panel.dataset.embedSrc;
      frame.title = panel.dataset.embedTitle;
      panel.append(frame);
    }

    panel.hidden = !show;
    button.setAttribute("aria-expanded", String(show));
    button.textContent = `${show ? "Hide" : "Show"} ${label}`;
  });
});

const trailer = document.querySelector(".trailer");
const video = trailer.querySelector("video");

trailer.addEventListener("toggle", () => {
  if (!trailer.open) {
    video.pause();
  }
});
