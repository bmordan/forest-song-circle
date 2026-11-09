import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import "lenis/dist/lenis.css";

gsap.registerPlugin(ScrollTrigger);

const FRAME_COUNT = 300;
const FRAME_CONCURRENCY = 6;
const MAX_DPR = 2;

function requiredEl<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) {
    throw new Error(`Missing element: ${selector}`);
  }
  return el;
}

function frameSrc(index: number): string {
  return `/frames/frame_${String(index).padStart(4, "0")}.webp`;
}

function initSmoothScroll() {
  const lenis = new Lenis({
    duration: 1.15,
    smoothWheel: true,
    touchMultiplier: 1.1,
  });

  lenis.on("scroll", ScrollTrigger.update);

  gsap.ticker.add((time) => {
    lenis.raf(time * 1000);
  });
  gsap.ticker.lagSmoothing(0);

  return lenis;
}

function createFrameLoader() {
  const images: (HTMLImageElement | undefined)[] = new Array(FRAME_COUNT + 1);
  const inflight = new Map<number, Promise<HTMLImageElement | undefined>>();

  function loadFrame(index: number): Promise<HTMLImageElement | undefined> {
    if (index < 1 || index > FRAME_COUNT) {
      return Promise.resolve(undefined);
    }

    const cached = images[index];
    if (cached?.complete && cached.naturalWidth > 0) {
      return Promise.resolve(cached);
    }

    const pending = inflight.get(index);
    if (pending) {
      return pending;
    }

    const promise = new Promise<HTMLImageElement | undefined>((resolve) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        images[index] = img;
        inflight.delete(index);
        resolve(img);
      };
      img.onerror = () => {
        inflight.delete(index);
        resolve(undefined);
      };
      img.src = frameSrc(index);
    });

    inflight.set(index, promise);
    return promise;
  }

  async function preloadAll(concurrency = FRAME_CONCURRENCY) {
    let next = 2;

    async function worker() {
      while (next <= FRAME_COUNT) {
        const index = next;
        next += 1;
        await loadFrame(index);
      }
    }

    const workers = Array.from(
      { length: Math.min(concurrency, FRAME_COUNT - 1) },
      () => worker(),
    );
    await Promise.all(workers);
  }

  function nearestLoaded(index: number): HTMLImageElement | undefined {
    const direct = images[index];
    if (direct?.complete && direct.naturalWidth > 0) {
      return direct;
    }

    for (let distance = 1; distance < FRAME_COUNT; distance += 1) {
      const lower = images[index - distance];
      if (lower?.complete && lower.naturalWidth > 0) {
        return lower;
      }
      const upper = images[index + distance];
      if (upper?.complete && upper.naturalWidth > 0) {
        return upper;
      }
    }

    return undefined;
  }

  return { loadFrame, preloadAll, nearestLoaded };
}

function createCanvasRenderer(canvas: HTMLCanvasElement) {
  const maybeCtx = canvas.getContext("2d", { alpha: false });
  if (!maybeCtx) {
    throw new Error("Unable to get 2d canvas context");
  }
  const ctx: CanvasRenderingContext2D = maybeCtx;

  let lastDrawnIndex = -1;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      lastDrawnIndex = -1;
    }
  }

  function drawCover(img: HTMLImageElement) {
    const canvasW = canvas.width;
    const canvasH = canvas.height;
    const imgW = img.naturalWidth;
    const imgH = img.naturalHeight;
    if (!imgW || !imgH || !canvasW || !canvasH) {
      return;
    }

    const scale = Math.max(canvasW / imgW, canvasH / imgH);
    const drawW = imgW * scale;
    const drawH = imgH * scale;
    const dx = (canvasW - drawW) / 2;
    const dy = (canvasH - drawH) / 2;

    ctx.fillStyle = "#1a1410";
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.drawImage(img, dx, dy, drawW, drawH);
  }

  function drawFrame(
    index: number,
    resolveImage: (index: number) => HTMLImageElement | undefined,
    force = false,
  ) {
    if (!force && index === lastDrawnIndex) {
      return;
    }

    const img = resolveImage(index);
    if (!img) {
      return;
    }

    drawCover(img);
    lastDrawnIndex = index;
  }

  return { resize, drawFrame };
}

function initScene(
  loader: ReturnType<typeof createFrameLoader>,
  renderer: ReturnType<typeof createCanvasRenderer>,
) {
  const scene = requiredEl<HTMLElement>("#scene");
  const ctas = requiredEl<HTMLElement>("#scene-ctas");
  const title = requiredEl<HTMLElement>(".scene__title");
  const scrollHint = requiredEl<HTMLElement>("#scene-scroll");

  gsap.set(ctas, { autoAlpha: 0, y: 24 });

  const state = { frame: 1 };

  const drawCurrent = (force = false) => {
    const index = Math.round(state.frame);
    renderer.drawFrame(index, (i) => loader.nearestLoaded(i), force);
  };

  renderer.resize();
  drawCurrent(true);

  const onResize = () => {
    renderer.resize();
    drawCurrent(true);
    ScrollTrigger.refresh();
  };
  window.addEventListener("resize", onResize);

  const tl = gsap.timeline({
    defaults: { ease: "none" },
    scrollTrigger: {
      trigger: scene,
      start: "top top",
      end: "+=300%",
      pin: true,
      scrub: true,
      anticipatePin: 1,
    },
  });

  tl.to(
    state,
    {
      frame: FRAME_COUNT,
      duration: 1,
      onUpdate: () => drawCurrent(),
    },
    0,
  )
    .to(scrollHint, { autoAlpha: 0, duration: 0.08 }, 0.04)
    .to(title, { autoAlpha: 0, duration: 0.18 }, 0.72)
    .to(ctas, { autoAlpha: 1, y: 0, duration: 0.2 }, 0.8);

  void loader.preloadAll();

  return tl;
}

async function boot() {
  const canvas = requiredEl<HTMLCanvasElement>("#scene-canvas");
  const loader = createFrameLoader();
  const renderer = createCanvasRenderer(canvas);

  initSmoothScroll();

  const first = await loader.loadFrame(1);
  renderer.resize();
  if (first) {
    renderer.drawFrame(1, () => first, true);
  }

  initScene(loader, renderer);
  ScrollTrigger.refresh();
}

boot();
