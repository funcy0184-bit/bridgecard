// assets.js — 美術圖預載與安全降級
//   · 模組一載入就開始非同步預載所有 PNG（角色基礎圖、武器圖、拼刀加購圖、特效圖）
//   · Assets.preload()：回傳 Promise，全部載完（或逾時）才 resolve —— 永遠不會 reject，進對戰前 await 它就不會第一下出招才閃圖
//   · 缺檔、載入失敗、尺寸不符：Console 印出警告（哪張圖、完整網址、預期尺寸），該圖回傳 null → 渲染層自動退回程式繪製
//   · Node（測試、伺服器）沒有 Image：直接視為「全部缺圖」，不報錯
import { ART, CONFIG } from "./config.js";

const TAG = "[拳刃交鋒 美術]";
const TIMEOUT_MS = 6000;

// 需要的圖：{ file, w, h, exact }（exact＝寬高必須完全相等；特效條只要求至少裝得下所有格）
function manifest() {
  const list = [];
  const atlas = (A, label) => { for (const p of ["p1", "p2"]) list.push({ file: A.imageByPlayer[p], w: A.imageWidth, h: A.imageHeight, exact: true, label }); };
  atlas(ART.spriteAtlas, "角色基礎動作");
  atlas(ART.weaponVariantAtlas, "武器變體");
  atlas(CONFIG.clashAtlas, "拼刀／開牌／勝利加購");
  atlas(CONFIG.extraAtlas, "開牌／勝利加購");
  // 選配包：CONFIG.ART_PACKS 沒開就完全不請求（檔案還沒放進來時不會在主控台冒 404）
  const on = pack => !pack || CONFIG.ART_PACKS?.[pack];
  if (on(CONFIG.charExtraAtlas.pack)) atlas(CONFIG.charExtraAtlas, "擴充角色動作");
  if (on(CONFIG.dummyAtlas.pack)) list.push({ file: CONFIG.dummyAtlas.imageByPlayer.p1, w: CONFIG.dummyAtlas.imageWidth, h: CONFIG.dummyAtlas.imageHeight, exact: true, label: "訓練場木樁" });
  if (on(CONFIG.uiV2.pack)) for (const [k, f] of Object.entries(CONFIG.uiV2.files)) list.push({ file: f, w: 1, h: 1, exact: false, label: `UI ${k}` });   // UI 圖尺寸以實際檔案為準
  for (const [key, v] of Object.entries(CONFIG.vfx)) if (on(v.pack)) list.push({ file: v.file, w: v.frameW * v.frames, h: v.frameH, exact: false, label: `特效 ${key}` });
  return list;
}

const images = {};          // file → HTMLImageElement（載入成功且尺寸正確才放進來）
const status = {};          // file → "ok" | "missing" | "size"
let pending = null;

function urlOf(file) { return new URL(`../${file}`, import.meta.url).href; }

function loadOne(m) {
  return new Promise(resolve => {
    const img = new Image(), url = urlOf(m.file);
    let done = false;
    const finish = st => { if (done) return; done = true; status[m.file] = st; resolve(); };
    const timer = setTimeout(() => { console.warn(`${TAG} 載入逾時：${m.file}（${m.label}）${url} → 改用程式繪製`); finish("missing"); }, TIMEOUT_MS);
    img.onload = () => {
      clearTimeout(timer);
      const W = img.naturalWidth, H = img.naturalHeight;
      const ok = m.exact ? W === m.w && H === m.h : W >= m.w && H >= m.h;
      if (!ok) { console.warn(`${TAG} 尺寸不符：${m.file}（${m.label}）實際 ${W}×${H}，預期 ${m.exact ? "" : "至少 "}${m.w}×${m.h}，${url} → 改用程式繪製`); finish("size"); return; }
      images[m.file] = img; finish("ok");
    };
    img.onerror = () => { clearTimeout(timer); console.warn(`${TAG} 缺少圖檔：${m.file}（${m.label}）${url} → 改用程式繪製`); finish("missing"); };
    img.src = url;
  });
}

function preload() {
  if (pending) return pending;
  if (typeof Image === "undefined") { pending = Promise.resolve(Assets.report()); return pending; }
  const seen = new Set(), list = manifest().filter(m => (seen.has(m.file) ? false : seen.add(m.file)));
  pending = Promise.all(list.map(loadOne)).then(() => {
    const r = Assets.report();
    console.info(`${TAG} 預載完成：${r.ok.length} 張可用${r.missing.length ? `，${r.missing.length} 張缺檔／不符（用程式繪製）：${r.missing.join("、")}` : ""}`);
    Assets.ready = true;
    return r;
  });
  return pending;
}

export const Assets = {
  ready: false,
  preload,
  get(file) { return images[file] ?? null; },
  has(file) { return !!images[file]; },
  report() { const files = Object.keys(status); return { ok: files.filter(f => status[f] === "ok"), missing: files.filter(f => status[f] !== "ok"), status: { ...status } }; },
};

preload();     // 一 import 就開始抓
