/*
 * DCU Sub-Aqua Club: the descent.
 *
 * Scroll position is treated as depth. One animation loop reads it and
 * drives the water colour, the dive console (bezel, depth scale, odometer),
 * the silhouettes in the background and the canvas layer (fish, bubbles,
 * marine snow and the tentacles near the bottom).
 */
(() => {
  "use strict";

  const START_DEPTH = 3; // metres shown at the top: the page opens underwater
  const MAX_DEPTH = 60; // metres shown at the bottom of the page
  const STOP_SPACING = 24; // degrees between stops on the bezel (matches styles.css)
  const SCALE_STEP = 5; // degrees of the inner depth scale per metre
  const TAU = Math.PI * 2;

  const ocean = document.querySelector(".ocean");
  const canvas = document.querySelector(".ocean-canvas");
  const ctx = canvas.getContext("2d");
  const surfaceCanvas = document.querySelector(".surface-canvas");
  const surfCtx = surfaceCanvas && surfaceCanvas.getContext("2d");
  const consoleNav = document.querySelector(".console");
  const toggle = document.querySelector(".console-toggle");
  const toggleLabel = toggle.querySelector(".visually-hidden");
  const stopList = document.querySelector(".stops");
  const stopItems = [...stopList.querySelectorAll("li")];
  const stopLinks = stopItems.map((item) => item.querySelector("a"));
  const bezel = document.querySelector(".dial-bezel");
  const scale = document.querySelector(".dial-scale");
  const dialGlass = document.querySelector(".dial-glass");
  const miniTicks = document.querySelector(".mini-ticks");
  const odometer = document.querySelector("[data-odometer]");
  const depthInt = document.querySelector("[data-depth-int]");
  const tempEl = document.querySelector("[data-temp]");
  const regulator = document.querySelector("[data-bubble-source]");
  const themeColor = document.querySelector('meta[name="theme-color"]');

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const wideLayout = matchMedia("(min-width: 1180px) and (min-height: 600px)");
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)");

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const rand = (min, max) => min + Math.random() * (max - min);
  const smoothstep = (edge0, edge1, value) => {
    const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  };

  /* ------------------------------------------------------------------ */
  /* Dial construction                                                   */
  /* ------------------------------------------------------------------ */

  const SVG_NS = "http://www.w3.org/2000/svg";

  function svg(tag, attributes) {
    const element = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, value);
    }
    return element;
  }

  function tick(group, degrees, r1, r2, className) {
    const angle = (degrees * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    group.append(
      svg("line", {
        x1: (r1 * cos).toFixed(2),
        y1: (r1 * sin).toFixed(2),
        x2: (r2 * cos).toFixed(2),
        y2: (r2 * sin).toFixed(2),
        class: className,
      }),
    );
  }

  // Outer bezel: a tick every 3°, a long one at every stop position.
  for (let i = 0; i < 120; i += 1) {
    const atStop = i % 8 === 0;
    tick(bezel, 180 + i * 3, atStop ? 183 : 188, 196, atStop ? "tick tick-major" : i % 4 === 0 ? "tick tick-mid" : "tick");
  }

  // Inner depth scale: one tick per metre, past 40 m in signal orange.
  for (let metre = 0; metre <= MAX_DEPTH; metre += 1) {
    const major = metre % 10 === 0;
    const mid = metre % 5 === 0;
    const limit = metre > 40 ? " tick-limit" : "";
    tick(scale, 180 + metre * SCALE_STEP, major ? 86 : mid ? 91 : 95, 101, `tick${major ? " tick-major" : mid ? " tick-mid" : ""}${limit}`);
  }

  // Compact gauge for small screens.
  for (let i = 0; i < 60; i += 1) {
    tick(miniTicks, i * 6, i % 5 === 0 ? 37 : 41, 46, `mini-tick${i % 5 === 0 ? " tick-major" : ""}`);
  }
  miniTicks.parentNode.append(svg("path", { d: "M-4.5 -49.5h9l-4.5 8z", class: "mini-index" }));

  // Odometer reels: tens and ones, in whole metres.
  function reel(blankZero) {
    const windowEl = document.createElement("span");
    const strip = document.createElement("span");
    windowEl.className = "reel-window";
    strip.className = "reel";
    for (let digit = 0; digit <= 10; digit += 1) {
      const cell = document.createElement("span");
      cell.textContent = String(digit % 10);
      if (blankZero && digit % 10 === 0) cell.className = "blank";
      strip.append(cell);
    }
    windowEl.append(strip);
    return { windowEl, strip, pos: 0, drawn: -1 };
  }

  const reels = [reel(true), reel(false)];
  odometer.textContent = "";
  odometer.append(reels[0].windowEl, reels[1].windowEl);

  // Each reel rolls the short way round to its digit, so the readout turns
  // like a mechanical counter while moving and settles on whole digits.
  function setOdometer(depth, dt, instant) {
    const metres = Math.round(clamp(depth, 0, 99));
    const targets = [Math.floor(metres / 10) % 10, metres % 10];
    const ease = instant ? 1 : 1 - Math.exp(-dt * 16);
    reels.forEach((r, i) => {
      const delta = ((((targets[i] - r.pos) % 10) + 15) % 10) - 5;
      r.pos = Math.abs(delta) < 0.002 ? targets[i] : (((r.pos + delta * ease) % 10) + 10) % 10;
      if (Math.abs(r.pos - r.drawn) > 0.0005) {
        r.drawn = r.pos;
        r.strip.style.transform = `translateY(${(-r.pos).toFixed(3)}em)`;
      }
    });
  }

  stopItems.forEach((item, index) => item.style.setProperty("--i", index));

  /* ------------------------------------------------------------------ */
  /* Water colour by depth                                               */
  /* ------------------------------------------------------------------ */

  const WATER = [
    [0.0, [52, 160, 174], [26, 115, 132], [15, 74, 92]],
    [0.1, [33, 128, 146], [19, 94, 114], [11, 63, 86]],
    [0.28, [18, 90, 119], [12, 65, 97], [8, 45, 74]],
    [0.48, [11, 58, 92], [7, 42, 72], [5, 28, 53]],
    [0.66, [6, 32, 59], [4, 21, 43], [3, 13, 30]],
    [0.84, [4, 17, 40], [3, 11, 27], [2, 7, 18]],
    [1.0, [6, 16, 25], [3, 9, 15], [2, 5, 9]],
  ];

  function waterAt(progress) {
    let i = 0;
    while (i < WATER.length - 2 && progress > WATER[i + 1][0]) i += 1;
    const [p0, ...a] = WATER[i];
    const [p1, ...b] = WATER[i + 1];
    const t = smoothstep(0, 1, clamp((progress - p0) / (p1 - p0), 0, 1));
    return a.map((colour, layer) => colour.map((channel, c) => Math.round(channel + (b[layer][c] - channel) * t)));
  }

  /* ------------------------------------------------------------------ */
  /* Scene contents                                                      */
  /* ------------------------------------------------------------------ */

  const creatures = [...document.querySelectorAll(".creature")].map((el) => ({
    el,
    at: Number(el.dataset.at),
    parallax: Number(el.dataset.parallax || 1),
    offset: Number(el.dataset.offset || 0),
    speed: Number(el.dataset.speed || 0),
    dir: Number(el.dataset.dir || 1),
    facing: Number(el.dataset.facing || 1),
    phase: Number(el.dataset.phase || 0),
    bob: Number(el.dataset.bob || 0),
    drift: el.hasAttribute("data-drift"),
    x: Number(el.dataset.x || 0),
    base: 0,
    w: 0,
    h: 0,
    shown: false,
  }));

  const SCHOOLS = [
    { at: 0.02, parallax: 0.9, offset: -0.2, count: 22, len: [11, 16], speed: 30, dir: 1, w: 240, h: 70, rgb: "4 46 58", alpha: 0.5 },
    { at: 0.08, parallax: 0.55, offset: 0.22, count: 36, len: [7, 10], speed: 16, dir: -1, w: 320, h: 90, rgb: "6 54 68", alpha: 0.34 },
    { at: 0.17, parallax: 0.8, offset: -0.08, count: 28, len: [12, 17], speed: 38, dir: -1, w: 280, h: 80, rgb: "3 38 54", alpha: 0.5 },
    { at: 0.25, parallax: 0.5, offset: 0.26, count: 46, len: [7, 11], speed: 20, dir: 1, w: 380, h: 110, rgb: "4 36 54", alpha: 0.3 },
    { at: 0.45, parallax: 0.85, offset: 0.22, count: 24, len: [14, 20], speed: 44, dir: -1, w: 300, h: 80, rgb: "2 24 42", alpha: 0.45 },
    { at: 0.985, parallax: 0.95, offset: 0.02, count: 14, len: [9, 13], speed: 18, dir: 1, w: 200, h: 60, rgb: "96 140 146", alpha: 0.28 },
  ].map((school) => ({
    ...school,
    start: Math.random() * 4000,
    members: Array.from({ length: school.count }, () => {
      const angle = Math.random() * TAU;
      const radius = Math.sqrt(Math.random());
      return {
        ox: Math.cos(angle) * radius * school.w * 0.5,
        oy: Math.sin(angle) * radius * school.h * 0.5,
        phase: Math.random() * TAU,
        len: rand(school.len[0], school.len[1]),
        beat: rand(0.85, 1.2),
      };
    }),
  }));

  const TENTACLES = [
    { at: 0.8, parallax: 0.72, side: -1, offset: 0.36, len: 0.95, width: 58, angle: -0.62, curl: 3.6, phase: 0, speed: 0.42 },
    { at: 0.87, parallax: 0.85, side: -1, offset: 0.56, len: 0.72, width: 40, angle: -0.98, curl: -2.7, phase: 2.1, speed: 0.55 },
    { at: 0.78, parallax: 0.62, side: 1, offset: 0.44, len: 0.85, width: 50, angle: Math.PI + 0.72, curl: -3.2, phase: 4.2, speed: 0.48 },
    { at: 0.95, parallax: 0.9, side: 0, x: 0.1, offset: 0.62, len: 0.8, width: 52, angle: -1.3, curl: 3.0, phase: 1.3, speed: 0.38 },
  ];

  /* ------------------------------------------------------------------ */
  /* Sprites                                                             */
  /* ------------------------------------------------------------------ */

  function sprite(size, draw) {
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    draw(c.getContext("2d"), size);
    return c;
  }

  const bubbleSprite = sprite(64, (g, s) => {
    const r = s / 2 - 2;
    const body = g.createRadialGradient(s * 0.42, s * 0.38, 1, s / 2, s / 2, r);
    body.addColorStop(0, "rgba(255,255,255,0.28)");
    body.addColorStop(0.7, "rgba(200,240,255,0.05)");
    body.addColorStop(1, "rgba(220,250,255,0.4)");
    g.fillStyle = body;
    g.beginPath();
    g.arc(s / 2, s / 2, r, 0, TAU);
    g.fill();
    g.strokeStyle = "rgba(232,252,255,0.6)";
    g.lineWidth = 2.2;
    g.stroke();
    g.fillStyle = "rgba(255,255,255,0.85)";
    g.beginPath();
    g.ellipse(s * 0.36, s * 0.3, s * 0.11, s * 0.06, -0.6, 0, TAU);
    g.fill();
  });

  const glowSprite = sprite(48, (g, s) => {
    const glow = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    glow.addColorStop(0, "rgba(190,255,240,1)");
    glow.addColorStop(0.2, "rgba(110,255,225,0.55)");
    glow.addColorStop(1, "rgba(60,200,220,0)");
    g.fillStyle = glow;
    g.fillRect(0, 0, s, s);
  });

  /* ------------------------------------------------------------------ */
  /* Measurements                                                        */
  /* ------------------------------------------------------------------ */

  let vw = innerWidth;
  let vh = innerHeight;
  let oceanH = vh;
  let maxScroll = 1;
  // The page height changes when a FAQ answer opens or an embed loads. The
  // background follows the new height smoothly instead of jumping.
  let maxScrollTarget = 0;
  let dpr = 1;
  let anchors = stopLinks.map(() => 0);
  let motes = [];
  let bubbles = [];

  const depthAt = (scrollY) => START_DEPTH + clamp(scrollY / maxScroll, 0, 1) * (MAX_DEPTH - START_DEPTH);
  const pageTop = (element) => element.getBoundingClientRect().top + window.scrollY;
  // Where the browser lands when you jump to a section, so a stop's depth
  // label matches the gauge after clicking it.
  const arrival = (element) =>
    clamp(pageTop(element) - (parseFloat(getComputedStyle(element).scrollMarginTop) || 0), 0, maxScrollTarget);

  function seedMotes() {
    const count = Math.round(clamp((vw * oceanH) / 9000, 40, 160));
    motes = Array.from({ length: count }, () => ({
      x: Math.random() * vw,
      y: Math.random() * oceanH,
      z: rand(0.35, 1),
      size: rand(0.6, 1.7),
      phase: Math.random() * TAU,
      fall: rand(-3, 5),
      glow: Math.random() < 0.2,
    }));
  }

  let sizedFor = "";

  function measure() {
    vw = innerWidth;
    vh = innerHeight;
    oceanH = ocean.clientHeight || vh;
    const target = Math.max(1, document.documentElement.scrollHeight - vh);
    if (!maxScrollTarget || reducedMotion.matches) maxScroll = target;
    maxScrollTarget = target;
    dpr = Math.min(window.devicePixelRatio || 1, vw < 720 ? 1.5 : 2);
    // Resizing a canvas clears it, so only do it when the window changes,
    // not every time the page gets taller or shorter.
    const size = `${vw}x${oceanH}@${dpr}`;
    if (size !== sizedFor) {
      sizedFor = size;
      canvas.width = Math.round(vw * dpr);
      canvas.height = Math.round(oceanH * dpr);
      sizeSchoolLayer();
      measureSurface();
    }

    anchors = stopLinks.map((link) => {
      const target = document.getElementById(link.hash.slice(1));
      return !target || link.hash === "#top" ? 0 : arrival(target);
    });
    for (let i = 1; i < anchors.length; i += 1) anchors[i] = Math.max(anchors[i], anchors[i - 1] + 1);

    stopLinks.forEach((link, i) => {
      link.querySelector("[data-stop-depth]").textContent = `${Math.round(depthAt(anchors[i]))} m`;
    });

    creatures.forEach((creature) => {
      creature.w = creature.el.offsetWidth;
      creature.h = creature.el.offsetHeight;
    });

    if (!motes.length || Math.abs(motes.length - (vw * oceanH) / 9000) > 30) seedMotes();
    measureTorch();
    lastState.depth = -1;
    lastState.stop = -1;
  }

  let measureQueued = false;
  function queueMeasure() {
    if (measureQueued) return;
    measureQueued = true;
    requestAnimationFrame(() => {
      measureQueued = false;
      measure();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Console                                                             */
  /* ------------------------------------------------------------------ */

  let shownDepth = START_DEPTH;
  let shownStop = 0;
  let previewStop = -1;
  let activeStop = -1;
  const lastState = { depth: -1, stop: -1, int: -1, temp: -1 };

  function stopIndexAt(scrollY) {
    if (scrollY <= anchors[0]) return 0;
    for (let i = 0; i < anchors.length - 1; i += 1) {
      if (scrollY < anchors[i + 1]) {
        const fraction = (scrollY - anchors[i]) / (anchors[i + 1] - anchors[i]);
        // Hold on a stop while you read it, then turn to the next one.
        return i + smoothstep(0.3, 0.88, fraction);
      }
    }
    return anchors.length - 1;
  }

  function updateConsole(dt, scrollY, instant) {
    const targetDepth = depthAt(scrollY);
    const locationStop = stopIndexAt(scrollY);
    const targetStop = previewStop >= 0 ? previewStop : locationStop;
    const ease = (rate) => (instant ? 1 : 1 - Math.exp(-dt * rate));

    shownDepth += (targetDepth - shownDepth) * ease(9);
    shownStop += (targetStop - shownStop) * ease(7);
    if (Math.abs(targetDepth - shownDepth) < 0.001) shownDepth = targetDepth;
    if (Math.abs(targetStop - shownStop) < 0.0005) shownStop = targetStop;

    setOdometer(shownDepth, dt, instant);
    if (Math.abs(shownDepth - lastState.depth) > 0.0005) {
      lastState.depth = shownDepth;
      if (wideLayout.matches) {
        scale.setAttribute("transform", `rotate(${(-shownDepth * SCALE_STEP).toFixed(3)})`);
      } else {
        miniTicks.setAttribute("transform", `rotate(${(-shownDepth * 6).toFixed(2)})`);
      }
      const whole = Math.round(shownDepth);
      if (whole !== lastState.int) {
        lastState.int = whole;
        depthInt.textContent = String(whole);
      }
      const temperature = Math.round(13 - (shownDepth / MAX_DEPTH) * 4);
      if (temperature !== lastState.temp) {
        lastState.temp = temperature;
        tempEl.textContent = String(temperature);
      }
    }

    if (wideLayout.matches && Math.abs(shownStop - lastState.stop) > 0.0003) {
      lastState.stop = shownStop;
      const turn = shownStop * STOP_SPACING;
      stopList.style.transform = `rotate(${turn.toFixed(3)}deg)`;
      bezel.setAttribute("transform", `rotate(${turn.toFixed(3)})`);
      stopItems.forEach((item, i) => {
        const away = Math.abs(i - shownStop) * STOP_SPACING;
        const opacity = clamp(1 - (away - 12) / 72, 0, 1);
        item.style.opacity = opacity.toFixed(3);
        stopLinks[i].style.pointerEvents = opacity < 0.25 ? "none" : "";
      });
    }

    const active = Math.round(locationStop);
    if (active !== activeStop) {
      activeStop = active;
      stopItems.forEach((item, i) => {
        item.classList.toggle("is-active", i === active);
        if (i === active) stopLinks[i].setAttribute("aria-current", "location");
        else stopLinks[i].removeAttribute("aria-current");
      });
    }
  }

  function resetConsoleLayout() {
    stopList.style.transform = "";
    stopItems.forEach((item, i) => {
      item.style.opacity = "";
      stopLinks[i].style.pointerEvents = "";
    });
    scale.removeAttribute("transform");
    miniTicks.removeAttribute("transform");
    lastState.depth = -1;
    lastState.stop = -1;
    setOpen(false);
  }

  function setOpen(open) {
    consoleNav.toggleAttribute("data-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggleLabel.textContent = open ? "Close sections" : "Sections";
  }

  toggle.addEventListener("click", () => setOpen(toggle.getAttribute("aria-expanded") !== "true"));

  stopList.addEventListener("click", (event) => {
    if (event.target.closest("a")) setOpen(false);
  });

  // On the desktop gauge a mouse opens it by hovering; a tap opens it too.
  dialGlass.addEventListener("pointerdown", (event) => {
    if (wideLayout.matches && event.pointerType !== "mouse") setOpen(!consoleNav.hasAttribute("data-open"));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && consoleNav.hasAttribute("data-open")) {
      setOpen(false);
      toggle.focus();
    }
  });

  document.addEventListener("pointerdown", (event) => {
    if (consoleNav.hasAttribute("data-open") && !consoleNav.contains(event.target)) setOpen(false);
  });

  // Keyboard users: turn the bezel to whichever stop has focus.
  stopLinks.forEach((link, i) => {
    link.addEventListener("focus", () => {
      if (wideLayout.matches && link.matches(":focus-visible")) previewStop = i;
    });
    link.addEventListener("blur", () => {
      if (previewStop === i) previewStop = -1;
    });
  });

  wideLayout.addEventListener("change", () => {
    resetConsoleLayout();
    queueMeasure();
  });

  /* ------------------------------------------------------------------ */
  /* Background                                                          */
  /* ------------------------------------------------------------------ */

  let lastWater = -1;
  let lastTheme = 0;

  function updateWater(progress, now) {
    if (Math.abs(progress - lastWater) < 0.0004) return;
    lastWater = progress;
    const [top, middle, bottom] = waterAt(progress);
    const style = ocean.style;
    style.setProperty("--w1", `rgb(${top.join(" ")})`);
    style.setProperty("--w2", `rgb(${middle.join(" ")})`);
    style.setProperty("--w3", `rgb(${bottom.join(" ")})`);
    style.setProperty("--sun", (1 - smoothstep(0, 0.3, progress)).toFixed(3));
    style.setProperty("--shade", (0.12 + 0.62 * smoothstep(0.35, 0.95, progress)).toFixed(3));
    style.setProperty("--torch", (finePointer.matches ? smoothstep(0.6, 0.8, progress) : 0).toFixed(3));
    if (themeColor && now - lastTheme > 250) {
      lastTheme = now;
      themeColor.setAttribute("content", `rgb(${top.join(",")})`);
    }
  }

  /* The underside of the surface: near the top of the page you are only a
     few metres down, so the surface ripples overhead and throws a moving
     net of light (caustics). It slides away upwards as you descend. Drawn
     at half resolution; it is soft light, and the CSS blurs it anyway. */
  let surfaceW = 0;
  let surfaceH = 0;
  let surfaceShown = false;

  function measureSurface() {
    if (!surfCtx) return;
    surfaceW = Math.ceil(vw / 2);
    surfaceH = Math.ceil(surfaceCanvas.clientHeight / 2) || 1;
    surfaceCanvas.width = surfaceW;
    surfaceCanvas.height = surfaceH;
    surfaceShown = false;
  }

  function drawSurface(t, progress, still) {
    if (!surfCtx) return;
    const near = 1 - smoothstep(0, 0.2, progress);
    ocean.style.setProperty("--surface", (1 - near).toFixed(3));
    if (near <= 0.005) {
      if (surfaceShown) surfCtx.clearRect(0, 0, surfaceW, surfaceH);
      surfaceShown = false;
      return;
    }
    if (still && surfaceShown) return;
    surfaceShown = true;
    const W = surfaceW;
    const H = surfaceH;
    const g = surfCtx;
    g.clearRect(0, 0, W, H);
    g.globalCompositeOperation = "source-over";

    // The bright sheet of the surface itself, with a rolling lower edge.
    const sheet = g.createLinearGradient(0, 0, 0, H * 0.5);
    sheet.addColorStop(0, "rgba(225, 255, 250, 0.5)");
    sheet.addColorStop(1, "rgba(190, 245, 240, 0)");
    g.fillStyle = sheet;
    g.beginPath();
    g.moveTo(0, 0);
    for (let x = 0; x <= W + 8; x += 8) {
      const y = H * 0.26 + Math.sin(x * 0.011 + t * 0.7) * H * 0.05 + Math.sin(x * 0.027 - t * 1.1) * H * 0.025;
      g.lineTo(x, y);
    }
    g.lineTo(W, 0);
    g.closePath();
    g.fill();

    // Two families of wavy lines crossing each other read as the caustic
    // net. Rows bunch up towards the top, as a surface seen from below does.
    g.globalCompositeOperation = "lighter";
    g.lineJoin = "round";
    const rows = 11;
    for (let family = 0; family < 2; family += 1) {
      const dir = family ? -1 : 1;
      for (let k = 0; k < rows; k += 1) {
        const f = k / (rows - 1);
        const base = H * (0.02 + 0.8 * f ** 1.5);
        const amp = H * (0.03 + 0.05 * f);
        const fade = (1 - f) ** 1.3;
        g.strokeStyle = `rgba(215, 255, 248, ${(0.32 * fade).toFixed(3)})`;
        g.lineWidth = 0.6 + 1.6 * (1 - f);
        g.beginPath();
        for (let x = -10; x <= W + 10; x += 7) {
          const y = base
            + Math.sin(x * (0.018 - f * 0.006) * (family ? 1.27 : 1) + t * 0.9 * dir + k * 1.7) * amp
            + Math.sin(x * 0.047 + t * 1.6 * -dir + k * 0.6) * amp * 0.35;
          if (x === -10) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      }
    }

    // Glints where the waves catch the sun.
    for (let i = 0; i < 26; i += 1) {
      const x = ((i * 137.5 + t * (8 + (i % 5) * 3)) % (W + 40)) - 20;
      const y = H * (0.04 + 0.28 * ((i * 0.618) % 1));
      const pulse = Math.max(0, Math.sin(t * (1.3 + (i % 7) * 0.31) + i * 2.1));
      if (pulse < 0.35) continue;
      const r = 6 + (i % 4) * 4;
      const glint = g.createRadialGradient(x, y, 0, x, y, r);
      glint.addColorStop(0, `rgba(255, 255, 250, ${(0.4 * pulse).toFixed(3)})`);
      glint.addColorStop(1, "rgba(255, 255, 250, 0)");
      g.fillStyle = glint;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.globalCompositeOperation = "source-over";
  }

  function placeCreatures(t, scrollY) {
    for (const c of creatures) {
      const centre = vh / 2 + (c.at * maxScroll - scrollY) * c.parallax + c.offset * vh;
      const y = centre - c.h / 2 + Math.sin(t * 0.45 + c.phase * TAU) * c.bob;
      const onScreen = y < oceanH + 40 && y + c.h > -40;
      if (onScreen !== c.shown) {
        c.shown = onScreen;
        c.el.style.visibility = onScreen ? "visible" : "hidden";
        // Arriving at a creature's depth should show it, not an empty stretch
        // of its loop, so it enters part-way across the screen.
        if (onScreen) c.base = rand(0.32, 0.6) * (vw + c.w) - t * c.speed;
      }
      if (!onScreen) continue;

      let x;
      if (c.drift) {
        x = c.x * vw - c.w / 2 + Math.sin(t * 0.13 + c.phase * TAU) * 26;
      } else {
        const span = vw + c.w;
        const travelled = (((c.base + t * c.speed) % span) + span) % span;
        x = c.dir > 0 ? travelled - c.w : vw - travelled;
      }
      c.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scaleX(${c.dir * c.facing})`;
    }
  }

  // Each school is drawn at full strength into its own layer and then laid
  // over the water at the school's opacity, so fish that cross each other
  // don't make darker patches.
  const schoolLayer = document.createElement("canvas");
  const sctx = schoolLayer.getContext("2d");
  const SCHOOL_PAD = 44;

  function sizeSchoolLayer() {
    const w = Math.max(...SCHOOLS.map((s) => s.w)) + SCHOOL_PAD * 2;
    const h = Math.max(...SCHOOLS.map((s) => s.h)) + SCHOOL_PAD * 2;
    schoolLayer.width = Math.ceil(w * dpr);
    schoolLayer.height = Math.ceil(h * dpr);
  }

  // A small fusiform fish facing +x, centred on the origin: pointed snout,
  // deepest just behind the head, a narrow tail stalk and a forked tail.
  function fish(g, len, wag) {
    const h = len * 0.19;
    const tail = wag * len * 0.1;
    g.beginPath();
    g.moveTo(len * 0.5, 0);
    g.bezierCurveTo(len * 0.44, -h * 0.85, len * 0.16, -h * 1.08, -len * 0.14, -h * 0.62);
    g.quadraticCurveTo(-len * 0.28, -h * 0.3, -len * 0.35, tail * 0.45 - h * 0.14);
    g.lineTo(-len * 0.52, tail - h * 1.05);
    g.lineTo(-len * 0.43, tail);
    g.lineTo(-len * 0.52, tail + h * 1.05);
    g.lineTo(-len * 0.35, tail * 0.45 + h * 0.14);
    g.quadraticCurveTo(-len * 0.28, h * 0.3, -len * 0.14, h * 0.62);
    g.bezierCurveTo(len * 0.16, h * 1.08, len * 0.44, h * 0.85, len * 0.5, 0);
    g.moveTo(len * 0.1, -h * 0.98);
    g.lineTo(-len * 0.04, -h * 1.55);
    g.lineTo(-len * 0.1, -h * 0.8);
    g.fill();
  }

  function drawSchools(t, scrollY) {
    for (const s of SCHOOLS) {
      const cy = vh / 2 + (s.at * maxScroll - scrollY) * s.parallax + s.offset * vh + Math.sin(t * 0.21 + s.start) * 18;
      if (cy < -s.h - 60 || cy > oceanH + s.h + 60) continue;
      const span = vw + s.w * 2;
      const travelled = (s.start + t * s.speed) % span;
      const cx = s.dir > 0 ? travelled - s.w : vw + s.w - travelled;
      const bw = s.w + SCHOOL_PAD * 2;
      const bh = s.h + SCHOOL_PAD * 2;
      const left = cx - bw / 2;
      const top = cy - bh / 2;

      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sctx.clearRect(0, 0, bw, bh);
      sctx.fillStyle = `rgb(${s.rgb})`;
      const vx = s.speed * s.dir;
      for (const m of s.members) {
        const sway = t * 0.7 + m.phase;
        const heave = t * 0.55 + m.phase * 1.3;
        const mx = cx + m.ox + Math.sin(sway) * 10;
        const wave = mx * 0.012 + t * 1.2;
        const my = cy + m.oy + Math.cos(heave) * 7 + Math.sin(wave) * 5;
        // Point each fish the way it is actually moving.
        const dx = vx + Math.cos(sway) * 7;
        const dy = -Math.sin(heave) * 3.85 + Math.cos(wave) * 5 * (1.2 + 0.012 * dx);
        const pitch = clamp(Math.atan2(dy, Math.abs(dx)), -0.45, 0.45);
        sctx.save();
        sctx.translate(mx - left, my - top);
        sctx.scale(s.dir, 1);
        sctx.rotate(pitch);
        fish(sctx, m.len, Math.sin(t * 9 * m.beat + m.phase));
        sctx.restore();
      }

      ctx.globalAlpha = s.alpha;
      ctx.drawImage(schoolLayer, 0, 0, bw * dpr, bh * dpr, left, top, bw, bh);
    }
    ctx.globalAlpha = 1;
  }

  function drawTentacles(t, scrollY, progress) {
    const presence = smoothstep(0.66, 0.8, progress);
    if (presence <= 0) return;

    for (const T of TENTACLES) {
      const length = Math.min(T.len * vh, 860);
      const baseX = T.side < 0 ? -34 : T.side > 0 ? vw + 34 : T.x * vw;
      const baseY = vh / 2 + (T.at * maxScroll - scrollY) * T.parallax + T.offset * vh;
      if (baseY - length > oceanH + 60 || baseY + length < -60) continue;

      const segments = 56;
      const step = length / segments;
      const inside = Math.sign(T.curl);
      let angle = T.angle + Math.sin(t * T.speed + T.phase) * 0.18;
      let x = baseX;
      let y = baseY;
      const left = [];
      const right = [];
      const suckers = [];

      for (let i = 0; i <= segments; i += 1) {
        const k = i / segments;
        const width = T.width * Math.pow(1 - k, 1.15) + 1.4;
        const nx = -Math.sin(angle);
        const ny = Math.cos(angle);
        left.push(x - nx * width * 0.5, y - ny * width * 0.5);
        right.push(x + nx * width * 0.5, y + ny * width * 0.5);
        if (i % 2 === 0 && k > 0.05 && k < 0.8) {
          suckers.push(x + nx * width * 0.26 * inside, y + ny * width * 0.26 * inside, width * 0.15);
        }
        const bend =
          T.curl * Math.pow(k, 2.3) * (1 + 0.4 * Math.sin(t * T.speed * 1.6 + T.phase + k * 3)) +
          Math.sin(t * T.speed * 2.1 + T.phase - k * 6) * 0.55 * k;
        angle += bend / segments;
        x += Math.cos(angle) * step;
        y += Math.sin(angle) * step;
      }

      ctx.globalAlpha = presence;
      ctx.beginPath();
      ctx.moveTo(left[0], left[1]);
      for (let i = 2; i < left.length; i += 2) ctx.lineTo(left[i], left[i + 1]);
      for (let i = right.length - 2; i >= 0; i -= 2) ctx.lineTo(right[i], right[i + 1]);
      ctx.closePath();
      const shade = ctx.createLinearGradient(baseX, baseY, x, y);
      shade.addColorStop(0, "rgb(30 12 26)");
      shade.addColorStop(0.55, "rgb(58 24 44)");
      shade.addColorStop(1, "rgb(84 38 60)");
      ctx.fillStyle = shade;
      ctx.fill();

      // Rim light on the outer edge.
      ctx.strokeStyle = "rgba(170, 205, 220, 0.16)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      const rim = inside > 0 ? left : right;
      ctx.moveTo(rim[0], rim[1]);
      for (let i = 2; i < rim.length; i += 2) ctx.lineTo(rim[i], rim[i + 1]);
      ctx.stroke();

      ctx.fillStyle = "rgba(196, 140, 160, 0.4)";
      for (let i = 0; i < suckers.length; i += 3) {
        ctx.beginPath();
        ctx.arc(suckers[i], suckers[i + 1], suckers[i + 2], 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  let breathIn = 2.5;

  function breathe() {
    const rect = regulator && regulator.getBoundingClientRect();
    const fromDiver = rect && rect.top > -20 && rect.top < vh;
    const count = Math.round(rand(9, 15));
    const x = fromDiver ? rect.left : rand(vw * 0.12, vw * 0.82);
    const y = fromDiver ? rect.top : oceanH + 24;
    for (let i = 0; i < count; i += 1) {
      bubbles.push({
        x: x + rand(-4, 4),
        y: y + rand(-3, 3),
        r: rand(1.4, fromDiver ? 4.6 : 6),
        phase: Math.random() * TAU,
        wobble: rand(8, 22),
        age: -i * rand(0.03, 0.08),
      });
    }
  }

  function drawBubbles(t, dt, scrollDelta, progress) {
    breathIn -= dt;
    if (breathIn <= 0) {
      breathIn = rand(3.8, 6.2);
      breathe();
    }
    if (Math.random() < dt * (1.4 - progress * 0.8)) {
      bubbles.push({ x: rand(0, vw), y: oceanH + 10, r: rand(1, 3.2), phase: Math.random() * TAU, wobble: rand(6, 16), age: 0 });
    }

    const keep = [];
    for (const b of bubbles) {
      b.age += dt;
      b.y -= scrollDelta;
      if (b.age < 0) {
        keep.push(b);
        continue;
      }
      b.y -= (24 + b.r * 9) * dt;
      b.x += Math.sin(t * 3 + b.phase) * b.wobble * dt;
      b.r *= 1 + dt * 0.03; // bubbles expand as they rise
      if (b.y < -30 || b.y > oceanH + 260) continue;
      keep.push(b);
      ctx.globalAlpha = Math.min(1, b.age * 3) * 0.85;
      ctx.drawImage(bubbleSprite, b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
    }
    bubbles = keep.length > 260 ? keep.slice(-260) : keep;
    ctx.globalAlpha = 1;
  }

  function drawMotes(t, dt, scrollDelta, progress, still) {
    const sunlit = 1 - smoothstep(0.15, 0.45, progress);
    const snow = smoothstep(0.35, 0.7, progress);
    const glow = smoothstep(0.55, 0.82, progress);
    const speck = sunlit * 0.42 + snow * 0.36;

    ctx.fillStyle = snow > sunlit ? "rgb(206 222 232)" : "rgb(226 255 250)";
    for (const m of motes) {
      if (!still) {
        m.y -= scrollDelta * m.z * 0.9;
        m.y += (m.fall + snow * 7 * m.z) * dt;
        m.x += Math.sin(t * 0.25 + m.phase) * 4 * dt;
        if (m.y < -12) m.y += oceanH + 24;
        else if (m.y > oceanH + 12) m.y -= oceanH + 24;
        if (m.x < -12) m.x += vw + 24;
        else if (m.x > vw + 12) m.x -= vw + 24;
      }

      if (m.glow) {
        if (glow < 0.01) continue;
        const pulse = 0.25 + 0.75 * Math.max(0, Math.sin(t * 0.8 + m.phase * 3));
        const size = 5 + m.size * 5;
        ctx.globalAlpha = glow * pulse * m.z * 0.8;
        ctx.drawImage(glowSprite, m.x - size / 2, m.y - size / 2, size, size);
      } else if (speck > 0.01) {
        ctx.globalAlpha = speck * m.z * (0.6 + 0.4 * Math.sin(t * 1.7 + m.phase));
        ctx.fillRect(m.x, m.y, m.size, m.size);
      }
    }
    ctx.globalAlpha = 1;
  }

  /* ------------------------------------------------------------------ */
  /* Seabed torch                                                        */
  /* ------------------------------------------------------------------ */

  // The footer scene is lit softly by the pointer. A canvas over the three
  // seabed layers dims the water a little, less towards the front, and
  // lifts it to full brightness in a soft pool wherever the pointer is.
  // Silt sparkles where the light catches it. On touch screens a tap moves
  // the light; until then it drifts slowly over the wreck.

  const seabed = document.querySelector(".seabed");
  const seabedLayers = document.querySelector(".seabed-layers");
  const torchCanvas = document.querySelector(".torch-light");
  const tctx = torchCanvas ? torchCanvas.getContext("2d") : null;

  const DARK = [2, 10, 16];
  const AMBIENT = 0.66; // how dim the water is away from the light, at the back
  const FRONT_LIFT = 0.35; // share of that taken off again at the front

  const torch = {
    w: 0,
    h: 0,
    scale: 1,
    pic: { x: 0, y: 0, w: 1, h: 1 }, // the picture's box inside the scene
    spot: null,
    aim: null,
    held: -Infinity, // when the pointer or a tap last moved the light
    lit: -1, // when the scene was first seen, -1 until then
    visible: false,
    drawn: false,
    pointer: { x: 0.5, y: 0.5 },
    silt: [],
  };

  // Where the light rests before anyone points: the middle of the wreck.
  const restingSpot = () => ({
    x: clamp(torch.pic.x + 0.55 * torch.pic.w, torch.w * 0.2, torch.w * 0.8),
    y: torch.pic.y + 0.56 * torch.pic.h,
  });

  function measureTorch() {
    if (!tctx) return;
    const scene = seabed.getBoundingClientRect();
    const pic = seabedLayers.getBoundingClientRect();
    torch.w = seabed.clientWidth;
    torch.h = seabed.clientHeight;
    torch.scale = Math.min(dpr, 1.25);
    const tw = Math.round(torch.w * torch.scale);
    const th = Math.round(torch.h * torch.scale);
    if (torchCanvas.width !== tw || torchCanvas.height !== th) {
      torchCanvas.width = tw;
      torchCanvas.height = th;
      torch.drawn = false;
    }
    torch.pic = { x: pic.left - scene.left, y: pic.top - scene.top, w: pic.width, h: pic.height };
    if (!torch.spot) torch.spot = restingSpot();
    if (!torch.aim) torch.aim = restingSpot();
    if (!torch.silt.length) {
      for (let i = 0; i < 90; i += 1) {
        torch.silt.push({ x: Math.random(), y: rand(0.25, 1), r: rand(0.6, 1.8), drift: rand(-0.004, 0.004), sink: rand(0.002, 0.008), phase: Math.random() * TAU });
      }
    }
  }

  function updateTorch(now, dt, still) {
    if (!tctx || !torch.visible || !torch.spot) return;
    if (still && torch.drawn) return;
    const t = now / 1000;
    if (torch.lit < 0) torch.lit = still ? now - 2000 : now;

    // Touch screens with nobody tapping: drift slowly over the wreck.
    const pic = torch.pic;
    if (!finePointer.matches && !still && now - torch.held > 6000) {
      const rest = restingSpot();
      torch.aim = {
        x: rest.x + Math.sin(t * 0.21) * Math.min(pic.w * 0.28, torch.w * 0.3),
        y: rest.y + Math.sin(t * 0.33 + 1) * pic.h * 0.1,
      };
    }
    const ease = still ? 1 : 1 - Math.exp(-dt * 7);
    torch.spot.x += (torch.aim.x - torch.spot.x) * ease;
    torch.spot.y += (torch.aim.y - torch.spot.y) * ease;
    const px = torch.spot.x;
    const py = torch.spot.y;

    // Fade in the first time the scene comes into view.
    const power = smoothstep(0, 900, now - torch.lit);
    const r = clamp(pic.w * 0.2, 170, 300);

    const g = tctx;
    g.setTransform(torch.scale, 0, 0, torch.scale, 0, 0);
    g.clearRect(0, 0, torch.w, torch.h);

    // Dim water with a soft pool of light cut out of it. No hard edge and
    // no beam: it reads as the place you are looking, not a spotlight.
    const dark = (k) => `rgb(${DARK[0]} ${DARK[1]} ${DARK[2]} / ${(AMBIENT * (1 - (1 - k) * power)).toFixed(3)})`;
    const pool = g.createRadialGradient(px, py, 0, px, py, r * 1.6);
    pool.addColorStop(0, dark(0));
    pool.addColorStop(0.3, dark(0.06));
    pool.addColorStop(0.62, dark(0.45));
    pool.addColorStop(1, dark(1));
    g.fillStyle = pool;
    g.fillRect(0, 0, torch.w, torch.h);

    // Nearer things catch more of the light: thin the dimming towards the
    // bottom of the picture, where the sand and the near rocks are.
    g.globalCompositeOperation = "destination-out";
    const front = g.createLinearGradient(0, pic.y + pic.h * 0.35, 0, pic.y + pic.h);
    front.addColorStop(0, "rgb(0 0 0 / 0)");
    front.addColorStop(1, `rgb(0 0 0 / ${FRONT_LIFT})`);
    g.fillStyle = front;
    g.fillRect(0, 0, torch.w, torch.h);

    // A gentle lift in the middle of the pool.
    g.globalCompositeOperation = "lighter";
    const glow = g.createRadialGradient(px, py, 0, px, py, r);
    glow.addColorStop(0, `rgb(150 200 195 / ${(0.12 * power).toFixed(3)})`);
    glow.addColorStop(0.5, `rgb(120 180 180 / ${(0.05 * power).toFixed(3)})`);
    glow.addColorStop(1, "rgb(120 180 180 / 0)");
    g.fillStyle = glow;
    g.fillRect(px - r, py - r, r * 2, r * 2);
    g.globalCompositeOperation = "source-over";

    // Silt: faint everywhere, bright in the light.
    g.fillStyle = "rgb(225 245 238)";
    for (const p of torch.silt) {
      if (!still) {
        p.x = (p.x + p.drift * dt + 1) % 1;
        p.y += p.sink * dt;
        if (p.y > 1) p.y = 0.25;
      }
      const qx = p.x * torch.w + Math.sin(t * 0.6 + p.phase) * 6;
      const qy = p.y * torch.h + Math.cos(t * 0.5 + p.phase) * 4;
      const inPool = 1 - smoothstep(0.25, 1, Math.hypot(qx - px, qy - py) / r);
      const a = (0.05 + 0.6 * inPool) * power;
      if (a < 0.015) continue;
      g.globalAlpha = a;
      g.fillRect(qx, qy, p.r, p.r);
    }
    g.globalAlpha = 1;
    torch.drawn = true;
  }

  // Easter egg: the moray in the hull breach pops out while you point at
  // the hole, and ducks back in a moment after you move away.
  const hole = document.querySelector(".wreck-hole");
  const egg = document.querySelector(".wreck-egg");
  let eggTimer = 0;

  function overHole(clientX, clientY) {
    if (!hole || !egg) return false;
    const r = hole.getBoundingClientRect();
    const dx = (clientX - (r.left + r.width / 2)) / (r.width / 2);
    const dy = (clientY - (r.top + r.height / 2)) / (r.height / 2);
    return dx * dx + dy * dy < 0.75;
  }

  function peek(ms) {
    egg.classList.add("is-out");
    clearTimeout(eggTimer);
    eggTimer = setTimeout(() => egg.classList.remove("is-out"), ms);
  }

  function aimTorch(clientX, clientY) {
    const scene = seabed.getBoundingClientRect();
    const x = clientX - scene.left;
    const y = clientY - scene.top;
    if (x < 0 || x > scene.width || y < 0 || y > scene.height) return false;
    torch.aim = { x, y };
    torch.held = performance.now();
    return true;
  }

  if (tctx) {
    new IntersectionObserver(
      ([entry]) => {
        torch.visible = entry.isIntersecting;
      },
      { threshold: 0.2 },
    ).observe(seabed);

    seabed.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "mouse") {
        aimTorch(event.clientX, event.clientY);
        if (overHole(event.clientX, event.clientY)) peek(3000);
      }
    });

    if (finePointer.matches) {
      window.addEventListener(
        "pointermove",
        (event) => {
          torch.pointer.x = event.clientX / vw;
          torch.pointer.y = event.clientY / vh;
          if (torch.visible) {
            aimTorch(event.clientX, event.clientY);
            if (overHole(event.clientX, event.clientY)) peek(1200);
          }
        },
        { passive: true },
      );
    }
  }

  // The three seabed layers drift apart a little with the pointer, and
  // settle as the footer scrolls up into view.
  const layerState = { px: NaN, py: NaN, rise: NaN };
  function updateLayers(still) {
    if (!seabedLayers || !torch.visible) return;
    const top = seabed.getBoundingClientRect().top;
    const rise = still ? 0 : Math.round(clamp(top / vh, 0, 1) * 100) / 100;
    const px = still ? 0 : Math.round((torch.pointer.x - 0.5) * 200) / 100;
    const py = still ? 0 : Math.round((torch.pointer.y - 0.5) * 200) / 100;
    if (rise === layerState.rise && px === layerState.px && py === layerState.py) return;
    Object.assign(layerState, { rise, px, py });
    seabedLayers.style.setProperty("--rise", rise);
    seabedLayers.style.setProperty("--px", px);
    seabedLayers.style.setProperty("--py", py);
  }

  /* ------------------------------------------------------------------ */
  /* Loop                                                                */
  /* ------------------------------------------------------------------ */

  let lastFrame = performance.now();
  let lastScroll = window.scrollY;
  let firstFrame = true;

  function frame(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    const still = reducedMotion.matches;
    const t = still ? 0 : now / 1000;
    if (maxScroll !== maxScrollTarget) {
      maxScroll += (maxScrollTarget - maxScroll) * (1 - Math.exp(-dt * 5));
      if (Math.abs(maxScrollTarget - maxScroll) < 0.5) maxScroll = maxScrollTarget;
    }
    const scrollY = clamp(window.scrollY, 0, maxScroll);
    const scrollDelta = scrollY - lastScroll;
    lastScroll = scrollY;
    const progress = clamp(scrollY / maxScroll, 0, 1);

    updateWater(progress, now);
    drawSurface(t, progress, still);
    updateConsole(dt, scrollY, firstFrame || still);
    placeCreatures(t, scrollY);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, oceanH);
    drawMotes(t, dt, scrollDelta, progress, still);
    drawSchools(t, scrollY);
    drawTentacles(t, scrollY, progress);
    if (!still) drawBubbles(t, dt, scrollDelta, progress);
    updateLayers(still);
    updateTorch(now, dt, still);

    firstFrame = false;
    requestAnimationFrame(frame);
  }

  if (finePointer.matches) {
    window.addEventListener(
      "pointermove",
      (event) => {
        ocean.style.setProperty("--mx", `${event.clientX}px`);
        ocean.style.setProperty("--my", `${event.clientY}px`);
      },
      { passive: true },
    );
  }

  /* ------------------------------------------------------------------ */
  /* Photo carousels                                                     */
  /* ------------------------------------------------------------------ */

  // A scroll-snapping strip: swipe or scroll it, press a dot, or use the
  // arrow keys (they wrap round at the ends). It moves on by itself every few
  // seconds while it is on screen, unless you are pointing at it, have
  // focused it, or prefer reduced motion.
  document.querySelectorAll("[data-gallery]").forEach((gallery) => {
    const track = gallery.querySelector(".gallery-track");
    const slides = [...track.children];
    const dots = [...gallery.querySelectorAll(".gallery-dots button")];
    let current = -1;
    let paused = false;
    let seen = false;

    const show = (i) => {
      if (i === current) return;
      current = i;
      dots.forEach((dot, k) => {
        dot.classList.toggle("is-current", k === i);
        dot.setAttribute("aria-pressed", String(k === i));
      });
    };
    const go = (i) => {
      const next = (i + slides.length) % slides.length;
      track.scrollTo({ left: next * track.clientWidth, behavior: reducedMotion.matches ? "auto" : "smooth" });
    };

    track.addEventListener("scroll", () => show(clamp(Math.round(track.scrollLeft / track.clientWidth), 0, slides.length - 1)), { passive: true });
    dots.forEach((dot, k) => dot.addEventListener("click", () => go(k)));
    track.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      go(current + (event.key === "ArrowRight" ? 1 : -1));
    });
    gallery.addEventListener("pointerenter", () => { paused = true; });
    gallery.addEventListener("pointerleave", () => { paused = false; });
    gallery.addEventListener("focusin", () => { paused = true; });
    gallery.addEventListener("focusout", () => { paused = false; });
    new IntersectionObserver(([entry]) => { seen = entry.isIntersecting; }, { threshold: 0.5 }).observe(gallery);
    setInterval(() => {
      if (seen && !paused && !reducedMotion.matches && !document.hidden) go(current + 1);
    }, 6000);
    show(0);
  });

  /* ------------------------------------------------------------------ */
  /* FAQ                                                                 */
  /* ------------------------------------------------------------------ */

  // Answers slide open and shut instead of jumping. The <details> element
  // still works on its own without this (and with reduced motion).
  document.querySelectorAll(".faq-list details").forEach((item) => {
    const summary = item.querySelector("summary");
    const answer = item.querySelector("p");
    let motion = null;
    let closing = false;

    summary.addEventListener("click", (event) => {
      if (reducedMotion.matches || !item.animate) return;
      event.preventDefault();
      const from = item.offsetHeight;
      if (motion) motion.cancel();
      closing = item.open && !closing;
      if (!closing) item.open = true;
      const to = closing ? summary.offsetHeight + item.offsetHeight - item.clientHeight : item.offsetHeight;
      item.classList.add("is-moving");
      motion = item.animate({ height: [`${from}px`, `${to}px`] }, { duration: 340, easing: "cubic-bezier(.3, 0, .2, 1)" });
      if (answer) {
        answer.animate({ opacity: closing ? [1, 0] : [0, 1], translate: closing ? ["0 0", "0 -6px"] : ["0 -6px", "0 0"] }, { duration: 340, easing: "ease-out", fill: closing ? "forwards" : "none" });
      }
      motion.onfinish = () => {
        if (closing) item.open = false;
        closing = false;
        motion = null;
        item.classList.remove("is-moving");
        if (answer) answer.getAnimations().forEach((a) => a.cancel());
      };
    });
  });

  /* ------------------------------------------------------------------ */
  /* Embeds                                                              */
  /* ------------------------------------------------------------------ */

  document.querySelectorAll("[data-load-embed]").forEach((button) => {
    const panel = document.getElementById(button.getAttribute("aria-controls"));
    const host = button.closest("[data-embed-host]");
    button.hidden = false;

    button.addEventListener("click", () => {
      if (!panel.firstElementChild) {
        const frameEl = document.createElement("iframe");
        frameEl.src = panel.dataset.embedSrc;
        frameEl.title = panel.dataset.embedTitle;
        panel.append(frameEl);
      }
      panel.hidden = false;
      host.classList.add("is-loaded");
      panel.firstElementChild.focus();
    });
  });

  /* ------------------------------------------------------------------ */
  /* Committee carousel                                                  */
  /* ------------------------------------------------------------------ */

  // The full committee sits in one strip that drifts slowly to the left and
  // loops forever. One copy of the list is cloned on each side, and the
  // scroll position is quietly moved by one copy's width whenever it strays
  // too far, so there is never an end. Anyone can take over at any moment by
  // scrolling, swiping, dragging, using the arrow keys or the buttons; the
  // drift pauses while the pointer or focus is on it and resumes afterwards.
  function setUpCrew(track) {
    const list = track.querySelector(".crew");
    const originals = [...list.children];
    const nav = document.querySelector("[data-crew-nav]");
    if (originals.length < 2) return;

    const DRIFT = 26; // pixels per second
    const RESUME_AFTER = 5000; // ms of calm after someone scrolls or clicks
    const SETTLE = 250; // ms without scroll events before the loop is re-centred

    const cloneSet = () =>
      originals.map((item) => {
        const copy = item.cloneNode(true);
        copy.setAttribute("aria-hidden", "true");
        copy.inert = true;
        return copy;
      });
    list.prepend(...cloneSet());
    list.append(...cloneSet());
    const allImages = list.querySelectorAll("img");

    let loop = 0; // width of one full copy of the committee
    let step = 0; // width of one card plus the gap
    let pos = 0; // where the strip should be, in fractional pixels
    let lastSet = 0; // what scrollLeft read back after we last set it
    let velocity = 0;
    let lastUserScroll = -Infinity;
    let pausedUntil = 0;
    let hovering = false;
    let focusInside = false;
    let touching = false;
    let drag = null;
    let visible = false;
    let rafId = 0;
    let lastTick = 0;

    function measureCrew() {
      const first = list.children[0];
      const oldLoop = loop;
      loop = originals[0].offsetLeft - first.offsetLeft;
      step = list.children[1].offsetLeft - first.offsetLeft;
      if (loop === oldLoop) return;
      pos = oldLoop ? (pos / oldLoop) * loop : loop;
      place(true);
    }

    function wrapPos() {
      if (pos >= loop * 1.5) pos -= loop;
      else if (pos < loop * 0.5) pos += loop;
    }

    function place(force) {
      if (!force && Math.abs(pos - track.scrollLeft) < 0.25) return;
      track.scrollLeft = pos;
      lastSet = track.scrollLeft;
    }

    const drifting = (now) =>
      visible &&
      !reducedMotion.matches &&
      !hovering &&
      !focusInside &&
      !touching &&
      !drag &&
      now >= pausedUntil;

    function tick(now) {
      rafId = 0;
      const dt = Math.min(0.05, (now - lastTick) / 1000);
      lastTick = now;
      const target = drifting(now) ? DRIFT : 0;
      velocity += (target - velocity) * Math.min(1, dt * 2.5);
      if (Math.abs(velocity) < 0.05) velocity = 0;

      if (!touching && !drag && now - lastUserScroll > SETTLE) {
        pos += velocity * dt;
        wrapPos();
        place(false);
      }
      if (visible) rafId = requestAnimationFrame(tick);
    }

    function wake() {
      if (!rafId && visible) {
        lastTick = performance.now();
        rafId = requestAnimationFrame(tick);
      }
    }

    // Someone took over: stop dead (no leftover drift) and wait a while.
    function holdFor(ms) {
      velocity = 0;
      pausedUntil = Math.max(pausedUntil, performance.now() + ms);
    }

    track.addEventListener(
      "scroll",
      () => {
        if (Math.abs(track.scrollLeft - lastSet) <= 1.5) return;
        pos = track.scrollLeft;
        lastSet = pos;
        lastUserScroll = performance.now();
        holdFor(RESUME_AFTER);
        wake();
      },
      { passive: true },
    );

    const reel = track.closest(".crew-reel");
    const section = track.closest(".committee");
    reel.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "mouse") hovering = true;
    });
    reel.addEventListener("pointerleave", (event) => {
      if (event.pointerType === "mouse") hovering = false;
    });
    // Keyboard focus pauses the drift; a mouse click that focuses the strip
    // does not, or it would stay paused until something else was clicked.
    section.addEventListener("focusin", (event) => {
      focusInside = event.target.matches(":focus-visible");
    });
    section.addEventListener("focusout", (event) => {
      focusInside = Boolean(event.relatedTarget?.matches(":focus-visible") && section.contains(event.relatedTarget));
    });
    track.addEventListener(
      "touchstart",
      () => {
        touching = true;
        velocity = 0;
      },
      { passive: true },
    );
    const endTouch = () => {
      touching = false;
      lastUserScroll = performance.now();
      holdFor(RESUME_AFTER);
    };
    track.addEventListener("touchend", endTouch, { passive: true });
    track.addEventListener("touchcancel", endTouch, { passive: true });

    // Mouse users without a sideways scroll wheel can drag the strip.
    if (finePointer.matches) track.classList.add("is-draggable");
    track.addEventListener("dragstart", (event) => event.preventDefault());
    track.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      drag = { x: event.clientX, left: track.scrollLeft, id: event.pointerId };
      velocity = 0;
      track.setPointerCapture(event.pointerId);
      track.classList.add("is-dragging");
    });
    track.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      track.scrollLeft = drag.left - (event.clientX - drag.x);
    });
    const endDrag = (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      drag = null;
      track.classList.remove("is-dragging");
      lastUserScroll = performance.now();
      holdFor(RESUME_AFTER);
    };
    track.addEventListener("pointerup", endDrag);
    track.addEventListener("pointercancel", endDrag);

    nav.hidden = false;
    nav.querySelectorAll("[data-crew-step]").forEach((button) => {
      button.addEventListener("click", () => {
        const direction = Number(button.dataset.crewStep);
        pos = track.scrollLeft;
        wrapPos();
        place(true);
        const perPage = Math.max(1, Math.floor(track.clientWidth / step));
        const index = Math.round(pos / step) + direction * perPage;
        lastUserScroll = performance.now();
        holdFor(RESUME_AFTER + 2000);
        track.scrollTo({ left: index * step, behavior: reducedMotion.matches ? "auto" : "smooth" });
        wake();
      });
    });

    new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible) {
          allImages.forEach((image) => {
            image.loading = "eager";
          });
          wake();
        }
      },
      { rootMargin: "300px 0px" },
    ).observe(track);

    new ResizeObserver(measureCrew).observe(list);
    measureCrew();
  }

  const crewTrack = document.querySelector("[data-crew]");
  if (crewTrack) setUpCrew(crewTrack);

  /* ------------------------------------------------------------------ */
  /* Start                                                               */
  /* ------------------------------------------------------------------ */

  measure();
  new ResizeObserver(queueMeasure).observe(document.body);
  window.addEventListener("resize", queueMeasure);
  window.addEventListener("load", queueMeasure);
  if (document.fonts) document.fonts.ready.then(queueMeasure);
  requestAnimationFrame(frame);
})();
