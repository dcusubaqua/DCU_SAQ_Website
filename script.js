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

  const MAX_DEPTH = 60; // metres shown at the bottom of the page
  const STOP_SPACING = 24; // degrees between stops on the bezel (matches styles.css)
  const SCALE_STEP = 5; // degrees of the inner depth scale per metre
  const TAU = Math.PI * 2;

  const ocean = document.querySelector(".ocean");
  const canvas = document.querySelector(".ocean-canvas");
  const ctx = canvas.getContext("2d");
  const consoleNav = document.querySelector(".console");
  const toggle = document.querySelector(".console-toggle");
  const toggleLabel = toggle.querySelector(".visually-hidden");
  const stopList = document.querySelector(".stops");
  const stopItems = [...stopList.querySelectorAll("li")];
  const stopLinks = stopItems.map((item) => item.querySelector("a"));
  const bezel = document.querySelector(".dial-bezel");
  const scale = document.querySelector(".dial-scale");
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

  // Odometer reels: tens, ones, tenths.
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

  const reels = [reel(true), reel(false), reel(false)];
  const point = document.createElement("span");
  point.className = "reel-dot";
  point.textContent = ".";
  odometer.textContent = "";
  odometer.append(reels[0].windowEl, reels[1].windowEl, point, reels[2].windowEl);

  // Each reel rolls the short way round to its digit, so the readout turns
  // like a mechanical counter while moving and settles on whole digits.
  function setOdometer(depth, dt, instant) {
    const tenths = Math.round(clamp(depth, 0, 99.9) * 10);
    const targets = [Math.floor(tenths / 100) % 10, Math.floor(tenths / 10) % 10, tenths % 10];
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
    { at: 0.02, parallax: 0.9, offset: -0.2, count: 22, len: [11, 16], speed: 30, dir: 1, w: 240, h: 70, rgb: "4 46 58", alpha: 0.5, glint: true },
    { at: 0.08, parallax: 0.55, offset: 0.22, count: 36, len: [7, 10], speed: 16, dir: -1, w: 320, h: 90, rgb: "6 54 68", alpha: 0.34, glint: true },
    { at: 0.17, parallax: 0.8, offset: -0.08, count: 28, len: [12, 17], speed: 38, dir: -1, w: 280, h: 80, rgb: "3 38 54", alpha: 0.5, glint: true },
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
  let dpr = 1;
  let anchors = stopLinks.map(() => 0);
  let motes = [];
  let bubbles = [];

  const depthAt = (scrollY) => clamp(scrollY / maxScroll, 0, 1) * MAX_DEPTH;
  const pageTop = (element) => element.getBoundingClientRect().top + window.scrollY;
  // Where the browser lands when you jump to a section, so a stop's depth
  // label matches the gauge after clicking it.
  const arrival = (element) =>
    clamp(pageTop(element) - (parseFloat(getComputedStyle(element).scrollMarginTop) || 0), 0, maxScroll);

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

  function measure() {
    vw = innerWidth;
    vh = innerHeight;
    oceanH = ocean.clientHeight || vh;
    maxScroll = Math.max(1, document.documentElement.scrollHeight - vh);
    dpr = Math.min(window.devicePixelRatio || 1, vw < 720 ? 1.5 : 2);
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(oceanH * dpr);

    anchors = stopLinks.map((link) => {
      const target = document.getElementById(link.hash.slice(1));
      return !target || link.hash === "#top" ? 0 : arrival(target);
    });
    for (let i = 1; i < anchors.length; i += 1) anchors[i] = Math.max(anchors[i], anchors[i - 1] + 1);

    stopLinks.forEach((link, i) => {
      link.querySelector("[data-stop-depth]").textContent = `${Math.round(depthAt(anchors[i]))} m`;
    });

    document.querySelectorAll("[data-depth-at]").forEach((label) => {
      const section = label.closest("section");
      label.textContent = `${Math.round(depthAt(section ? arrival(section) : 0))} m`;
    });

    document.querySelectorAll("[data-max-depth]").forEach((label) => {
      label.textContent = `${MAX_DEPTH} m`;
    });

    creatures.forEach((creature) => {
      creature.w = creature.el.offsetWidth;
      creature.h = creature.el.offsetHeight;
    });

    if (!motes.length || Math.abs(motes.length - (vw * oceanH) / 9000) > 30) seedMotes();
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

  let shownDepth = 0;
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
        item.style.pointerEvents = opacity < 0.25 ? "none" : "";
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
    stopItems.forEach((item) => {
      item.style.opacity = "";
      item.style.pointerEvents = "";
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
    if (event.target.closest("a") && !wideLayout.matches) setOpen(false);
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

  function fish(x, y, len, dir, wag) {
    const d = dir * len;
    const w = wag * len * 0.09;
    ctx.beginPath();
    ctx.moveTo(x + d * 0.5, y);
    ctx.bezierCurveTo(x + d * 0.3, y - len * 0.2, x - d * 0.12, y - len * 0.17, x - d * 0.32, y - len * 0.03 + w * 0.4);
    ctx.lineTo(x - d * 0.53, y - len * 0.18 + w);
    ctx.lineTo(x - d * 0.45, y + w * 0.6);
    ctx.lineTo(x - d * 0.53, y + len * 0.18 + w);
    ctx.lineTo(x - d * 0.32, y + len * 0.03 + w * 0.4);
    ctx.bezierCurveTo(x - d * 0.12, y + len * 0.17, x + d * 0.3, y + len * 0.2, x + d * 0.5, y);
    ctx.fill();
  }

  function drawSchools(t, scrollY) {
    for (const s of SCHOOLS) {
      const cy = vh / 2 + (s.at * maxScroll - scrollY) * s.parallax + s.offset * vh + Math.sin(t * 0.21 + s.start) * 18;
      if (cy < -s.h - 60 || cy > oceanH + s.h + 60) continue;
      const span = vw + s.w * 2;
      const travelled = (s.start + t * s.speed) % span;
      const cx = s.dir > 0 ? travelled - s.w : vw + s.w - travelled;
      const colour = `rgb(${s.rgb})`;
      ctx.fillStyle = colour;
      ctx.globalAlpha = s.alpha;
      for (const m of s.members) {
        const mx = cx + m.ox + Math.sin(t * 0.7 + m.phase) * 10;
        const my = cy + m.oy + Math.cos(t * 0.55 + m.phase * 1.3) * 7 + Math.sin(mx * 0.012 + t * 1.2) * 5;
        fish(mx, my, m.len, s.dir, Math.sin(t * 9 * m.beat + m.phase));
        if (s.glint && Math.sin(t * 1.3 + m.phase * 7) > 0.985) {
          ctx.fillStyle = "rgb(225 248 250)";
          ctx.globalAlpha = 0.7;
          ctx.fill();
          ctx.fillStyle = colour;
          ctx.globalAlpha = s.alpha;
        }
      }
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
    const x = fromDiver ? rect.left : rand(vw * 0.12, Math.max(vw * 0.2, vw * 0.8 - (wideLayout.matches ? vw * 0.2 : 0)));
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
    const scrollY = clamp(window.scrollY, 0, maxScroll);
    const scrollDelta = scrollY - lastScroll;
    lastScroll = scrollY;
    const progress = clamp(scrollY / maxScroll, 0, 1);

    updateWater(progress, now);
    updateConsole(dt, scrollY, firstFrame || still);
    placeCreatures(t, scrollY);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, oceanH);
    drawMotes(t, dt, scrollDelta, progress, still);
    drawSchools(t, scrollY);
    drawTentacles(t, scrollY, progress);
    if (!still) drawBubbles(t, dt, scrollDelta, progress);

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
  /* Start                                                               */
  /* ------------------------------------------------------------------ */

  measure();
  new ResizeObserver(queueMeasure).observe(document.body);
  window.addEventListener("resize", queueMeasure);
  window.addEventListener("load", queueMeasure);
  if (document.fonts) document.fonts.ready.then(queueMeasure);
  requestAnimationFrame(frame);
})();
