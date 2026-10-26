// 妖怪拚台 A3：3 對 3、兩個擂台、召喚師、鬼魂觀眾、每隻角色的專屬登場／奧義／勝利動作
// PlayCanvas 2.23.3 + @viggle/splat-engine 0.3.2；素材全部是 PINOC 生成的潑濺角色與場景。
// 一次性動作（攻擊、受擊、登場、奧義…）由遊戲邏輯逐幀推進 animationTime，畫面與判定永遠同步，
// 背景分頁被降速、或用 __tick() 自動測試時結果也一致；循環動作（站姿、走路、拍手）交給引擎播放。
import * as pc from 'playcanvas';
import { Scene, Character, Animation, Environment, OrbitControls } from '@viggle/splat-engine';

// 載入失敗時把原因顯示在標題畫面（手機看不到主控台）；用新繪圖方式（WebGPU）失敗就自動改用相容模式（WebGL）重試一次
let BOOTED = false;
function showFatal(msg) {
  if (BOOTED) return;
  const el = document.getElementById('loading'); if (!el) return;
  const gl = new URLSearchParams(location.search).get('gl') === '1';
  el.style.color = '#ffb4a0';
  el.innerHTML = `載入失敗：${String(msg || '未知錯誤').slice(0, 180)}<br>`
    + (gl ? '<a href="" style="color:#e9b65a">重新整理</a>' : '正在改用相容模式重試…');
  if (!gl) setTimeout(() => { const q = new URLSearchParams(location.search); q.set('gl', '1'); location.search = q; }, 1800);
}
addEventListener('error', e => showFatal(e.message || e.error));
addEventListener('unhandledrejection', e => showFatal(e.reason && (e.reason.message || e.reason)));
setTimeout(() => { if (!BOOTED) { const el = document.getElementById('loading'); if (el && !el.innerHTML.includes('失敗')) el.innerHTML += '<br><small>第一次要下載約 40MB，網路慢會等比較久。卡太久可以試 <a href="?gl=1" style="color:#e9b65a">相容模式</a></small>'; } }, 45000);

const A = '../assets/';
// 素材版本號：splat 引擎會把角色／場景／動作存進瀏覽器快取（最多 1 小時）。
// 換了素材檔就把這個數字加 1，啟動時發現版本不同會清掉快取，玩家才會拿到新檔。
// （不能用網址加 ?v= 的做法：引擎靠副檔名判斷格式，加了會讀不到場景）
const ASSET_VER = '2';
try { if (localStorage.getItem('yokai.assetVer') !== ASSET_VER) { await caches.delete('viggle-asset-cache'); localStorage.setItem('yokai.assetVer', ASSET_VER); } } catch (e) { console.warn('asset cache reset skipped', e); }
const LANE_Z = -0.8;          // 兩人對打的直線（台前空地）
const SUMMONER_Z = -1.7;      // 召喚師站的位置
const CLIP_NEAR_Z = 2.0;      // 鏡頭前方的潑濺全部裁掉，避免糊影
const WALK_F = 1.8, WALK_B = 1.4, GRAV = 12;
const ICE = { r: 0.7, g: 0.9, b: 1 };

const STAGES = {
  temple: { name: '廟口戲台・中元夜', file: 'temple_stage.spz', arenaX: 3.0, snow: false, crowdZ: -2.5 },
  noh: { name: '神社能舞台・雪夜', file: 'noh_stage.spz', arenaX: 2.5, snow: true, crowdZ: -2.4 },
};

// 電腦難度：block＝格擋反應、think＝思考間隔倍率、ult＝有靈力時放奧義的機率、punish＝對手硬直時趁機出手
const DIFF = [
  { name: '簡單', block: 0.5, think: 1.6, ult: 0.3, punish: 0 },
  { name: '普通', block: 1.3, think: 1.0, ult: 0.55, punish: 0.3 },
  { name: '困難', block: 2.6, think: 0.65, ult: 0.85, punish: 0.8 },
];

// seg：播放原始動作的哪一段（佔全長比例）；act：判定有效的區間；time：實際播放秒數
const MOVES = {
  light: { clip: 'light', seg: [0.24, 0.82], act: [0.42, 0.57], time: 0.42, dmg: 6, guard: 12, bones: ['hand_r', 'hand_l'], react: 'hitL', meter: 7, push: 0.22, lunge: 0.12 },
  heavy: { clip: 'heavy', seg: [0.12, 0.82], act: [0.38, 0.58], time: 0.85, dmg: 13, guard: 24, bones: ['hand_r', 'hand_l'], react: 'knock', meter: 11, push: 0.5, lunge: 0.2 },
  kick: { clip: 'kick', seg: [0.05, 0.9], act: [0.30, 0.50], yaw: 70, time: 0.7, dmg: 9, guard: 16, bones: ['foot_r', 'foot_l'], react: 'hitH', meter: 9, push: 0.35, lunge: 0.1 },
};
const REACT = { hitL: { clip: 'hitL', seg: [0, 0.7], time: 0.35 }, hitH: { clip: 'hitH', seg: [0, 0.8], time: 0.5 } };

const ROSTER = {
  hugupo: { name: '虎姑婆', side: 'tw', file: 'hugupo_cat', alt: 'hugupo_tiger', scale: 1.0, pic: 'hugupo', spec: { name: '咬手指', kind: 'bite' }, ult: { name: '半夜的喀滋聲', kind: 'tiger' } },
  mosina: { name: '魔神仔', side: 'tw', file: 'mosina', scale: 0.78, pic: 'mosina', spec: { name: '請你吃雞腿', kind: 'chicken' }, ult: { name: '牽去山裡', kind: 'lost' } },
  lintou: { name: '林投姐', side: 'tw', file: 'lintou', scale: 1.0, pic: 'lintou', spec: { name: '討債', kind: 'debt' }, ult: { name: '林投樹下', kind: 'pandanus' } },
  kitsune: { name: '九尾狐', side: 'jp', file: 'kitsune', scale: 1.03, pic: 'kitsune', spec: { name: '狐火', kind: 'foxfire' }, ult: { name: '九尾狐火陣', kind: 'foxstorm' } },
  tengu: { name: '天狗', side: 'jp', file: 'tengu', scale: 1.1, pic: 'tengu', spec: { name: '羽團扇', kind: 'gust' }, ult: { name: '天狗風', kind: 'tornado' } },
  yukionna: { name: '雪女', side: 'jp', file: 'yukionna', scale: 1.05, pic: 'yukionna', spec: { name: '冰息', kind: 'frost' }, ult: { name: '吹雪', kind: 'blizzard' } },
};
const SIDES = {
  tw: { label: '台灣陣營', keys: ['hugupo', 'mosina', 'lintou'], summoner: 'ahue', summonerName: '收妖師 阿火', ring: '#ffcf5a', tal: '護身符', talCard: '護身符' },
  jp: { label: '日本陣營', keys: ['kitsune', 'tengu', 'yukionna'], summoner: 'saku', summonerName: '見習陰陽師 朔', ring: '#7fc4ff', tal: '式符・結界', talCard: '式符' },
};
const TAUNTS = {
  'hugupo|kitsune': ['狐狸精喔？阿嬤最會對付愛水的啦。', 'あら、おばあさん。その爪、隠しきれていませんよ。', '哎呀，婆婆，妳的爪子藏不住了喔。'],
  'hugupo|tengu': ['鼻子這麼長，咬起來應該很 Q 喔。', '婆さんの皮をかぶった虎か。この風で吹き飛ばしてくれよう！', '披著阿婆皮的老虎嗎？看我用這陣風把妳吹飛！'],
  'hugupo|yukionna': ['冷吱吱的，阿嬤幫妳煮一碗薑母鴨啦。', '温かいものは嫌い。あなたも凍らせてあげる。', '我討厭溫暖的東西。也把妳凍起來吧。'],
  'mosina|kitsune': ['漂亮姊姊，餓了齁？來，請妳吃雞腿～', '小さな坊や、狐に化かされたことはある？', '小娃兒，你被狐狸騙過嗎？'],
  'mosina|tengu': ['山裡是我的地盤啦，來，跟我走。', '山は我が庭。迷うのは貴様のほうだ。', '山是我的庭院。會迷路的是你。'],
  'mosina|yukionna': ['雪地裡迷路，最好玩了，嘻嘻。', '迷子の小鬼…雪に埋もれて眠りなさい。', '迷路的小鬼……埋在雪裡睡吧。'],
  'lintou|kitsune': ['騙人的感情，我最清楚了。', 'あら、恨みの匂い。いい香りね。', '哎呀，怨恨的味道。真香呢。'],
  'lintou|tengu': ['這筆債，我會一筆一筆討回來。', '怨霊ごとき、この羽団扇で吹き払ってくれる！', '區區怨靈，看我用羽團扇把妳吹散！'],
  'lintou|yukionna': ['妳的心，比雪還要冷。', '冷たいのは、あなたを裏切った人間のほうよ。', '冷的是背叛妳的那個人才對。'],
};

const CLIPS = {
  idle: 'fighting-stance-idle', walkF: 'walking', walkB: 'walk-backwards', light: 'claw-swipe',
  heavy: 'overhead-smash', kick: 'round-kick', block: 'block', dodge: 'dodge-roll-forward',
  hitL: 'hit-reaction-front', hitH: 'head-hit-reaction', knock: 'knocked-down-backwards',
  getup: 'getting-up-after-knockdown', ko: 'death-backwards', cheer: 'cheering', cast: 'cast-spell-forward',
  throw: 'throw-object-overhand', jump: 'jump', stand: 'standing-idle', clap: 'clapping',
  summon_ahue: 'summon-ahue', summon_saku: 'summon-saku',
};
for (const k of Object.keys(ROSTER)) { CLIPS['enter_' + k] = 'enter-' + k; CLIPS['ult_' + k] = 'ult-' + k; CLIPS['win_' + k] = 'win-' + k; }

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const QS = new URLSearchParams(location.search);

// ---------------------------------------------------------------- 場景
const canvas = $('c');
// 繪圖方式：手機預設用相容性最好的 WebGL（WebGPU 在 Android 上還不穩）；網址加 ?gl=1 強制 WebGL、?gpu=1 強制先試 WebGPU
const TOUCH_DEVICE = matchMedia('(pointer: coarse)').matches;
const BACKEND = QS.get('gl') === '1' ? 'webgl' : QS.get('gpu') === '1' ? undefined : TOUCH_DEVICE ? 'webgl' : undefined;
const scene = await Scene.create(canvas, { fov: 36, depth: QS.get('depth') === '1', preserveDrawingBuffer: true, bgColor: { r: 0.02, g: 0.015, b: 0.04, a: 1 }, ...(BACKEND ? { backend: BACKEND } : {}) });
scene.start();
const app = scene.app;
const cam = scene.cameraEntity;
const setLoading = t => { $('loading').textContent = t; };
async function retry(fn, label, tries = 3) {               // 本機伺服器偶爾會中斷大檔連線：失敗就等一下再試
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= tries) throw e;
      console.warn('retry', label, i, e && e.message);
      await new Promise(r => setTimeout(r, 400 * i));
    }
  }
}

// 地面高度曲線：PINOC 場景的地面不一定完全平，沿某條 z 線把點雲分格，取偏低的高度當地面
function groundProfile(env, z0) {
  const S = env.sampleWorldSample(160000), P = S.positions, Al = S.alpha;
  const bins = new Map();
  for (let k = 0; k < P.length / 3; k++) {
    if (Al && Al[k] < 0.4) continue;
    const x = P[3 * k], y = P[3 * k + 1], z = P[3 * k + 2];
    if (Math.abs(z - z0) > 0.35 || Math.abs(x) > 5 || y > 0.9 || y < -2) continue;
    const b = Math.round(x * 4);
    if (!bins.has(b)) bins.set(b, []);
    bins.get(b).push(y);
  }
  const pts = [];
  for (let b = -20; b <= 20; b++) {
    const ys = bins.get(b);
    if (ys && ys.length >= 8) { ys.sort((p, q) => p - q); pts.push([b / 4, ys[Math.floor(ys.length * 0.25)]]); }
  }
  if (!pts.length) pts.push([0, 0]);
  return pts;
}
function sampleProfile(pts, x) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return lerp(y0, y1, (x - x0) / (x1 - x0)); }
  return pts[pts.length - 1][1];
}

// 擂台一個 17MB：開場只等第一個，其他的等標題畫面出來後在背景下載（ensureStage）
const ENV = {}, STAGE_P = {};
let onStageLoaded = () => {};                      // 背景下載完成時的通知（G 在後面才宣告，先放空函式）
const ensureStage = key => STAGE_P[key] || (STAGE_P[key] = loadStage(key));
async function loadStage(key) {
  const st = STAGES[key];
  const env = await retry(() => Environment.load(scene, A + 'stages/' + st.file), st.file);
  await env.coarseReady;
  const pr = env.probeGroundDepth(-1);
  const mpu = pr && pr.depth ? 1.5 / pr.depth : 4;                  // PINOC 場景單位 → 公尺
  env.entity.setLocalScale(mpu, mpu, mpu);
  env.entity.setLocalPosition(0, 1.5, 0);                            // 拍攝點腳下的地板 = y 0
  env.setClipBounds(new pc.Vec3(-60, -5, -60), new pc.Vec3(60, 60, CLIP_NEAR_Z));
  ENV[key] = { env, mpu, lane: groundProfile(env, LANE_Z), back: groundProfile(env, SUMMONER_Z), crowd: groundProfile(env, st.crowdZ) };
  env.entity.enabled = false;
  onStageLoaded(key);
}
setLoading('載入擂台：' + STAGES.temple.name + '…');
await ensureStage('temple');

// 角色：6 隻戰鬥角色＋老虎形態＋2 位召喚師（高畫質），鬼魂觀眾 3 種 × 2（輕量版）
const CH = {};
const FIGHTER_FILES = [...new Set(Object.values(ROSTER).flatMap(r => [r.file, r.alt].filter(Boolean)))];
const MAIN_FILES = [...FIGHTER_FILES, 'ahue', 'saku'];
const GHOSTS = [['ghost_elder', 0.92], ['ghost_auntie', 0.9], ['ghost_kid', 0.68]];
setLoading('召喚角色中…');
await Promise.all(MAIN_FILES.map(async n => {
  CH[n] = await retry(() => Character.load(scene, A + 'characters/' + n + '.vsplat', { position: { x: 0, y: -40, z: LANE_Z } }), n);
  CH[n].prepareReveal();
  CH[n].setActive(false);
}));
const crowd = [];
await Promise.all(GHOSTS.flatMap(([n, s]) => [0, 1].map(async i => {
  const c = await retry(() => Character.load(scene, A + 'characters/' + n + '.vsplat', { position: { x: 0, y: -40, z: -3 } }), n);
  c.setScale(s, s, s);
  c.setActive(false);
  crowd.push({ c, file: n, clip: null, loop: false, cheerT: 0, seeded: false, slot: crowd.length });
})));
setLoading('載入動作…');
await Promise.all(Object.entries(CLIPS).map(([k, f]) => retry(() => Animation.loadGlb(scene, A + 'motions/' + f + '.glb', k), f)));

const DUR = {};
{
  const c = CH.kitsune; c.setActive(true);
  for (const k of Object.keys(CLIPS)) { c.playAnimation(k, { loop: false, rootMotion: false }); DUR[k] = c.armature.animationDuration || 60; }
  c.setActive(false);
}
const BONE = {};
for (const [n, c] of Object.entries(CH)) {
  const names = c.armature.boneNames;
  BONE[n] = Object.fromEntries(['hand_r', 'hand_l', 'foot_r', 'foot_l', 'head', 'pelvis'].map(b => [b, names.indexOf(b)]));
}

// ---------------------------------------------------------------- 特效（PlayCanvas 網格）
const MATS = {};
function mat(hex, add = true, op = 1) {
  const k = hex + add + op;
  if (MATS[k]) return MATS[k];
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color(0, 0, 0);
  m.emissive = new pc.Color().fromString(hex);
  m.useLighting = false;
  m.opacity = op;
  m.blendType = add ? (op < 1 ? pc.BLEND_ADDITIVEALPHA : pc.BLEND_ADDITIVE) : pc.BLEND_NORMAL;   // 半透明發光要用 ADDITIVEALPHA，否則透明度被忽略
  m.depthWrite = false;
  m.update();
  return (MATS[k] = m);
}
function mesh(type, hex, s, add = true, op = 1) {
  const e = new pc.Entity();
  e.addComponent('render', { type, material: mat(hex, add, op), castShadows: false, receiveShadows: false });
  e.setLocalScale(s, s, s);
  app.root.addChild(e);
  return e;
}
const fx = [];
function burst(x, y, hex, n = 10, speed = 2.5, size = 0.07, life = 0.45, add = true, up = 0, z = LANE_Z) {
  for (let i = 0; i < n; i++) {
    const e = mesh('sphere', hex, size, add);
    const a = Math.random() * Math.PI * 2, b = (Math.random() - 0.3) * Math.PI;
    const v = new pc.Vec3(Math.cos(a) * Math.cos(b), Math.sin(b) + up, Math.sin(a) * Math.cos(b) * 0.4).mulScalar(speed * (0.5 + Math.random()));
    e.setPosition(x, y, z);
    fx.push({ e, v, life: life * (0.6 + Math.random() * 0.6), max: life, s: size, drag: 0.9 });
  }
}
function smoke(x, y, scale = 1) { burst(x, y + 0.8 * scale, '#9a948c', 26, 1.6 * scale, 0.22 * scale, 0.9, false, 0.4); burst(x, y + 0.9, '#ffffff', 10, 2.2, 0.08, 0.5); }
function summonCircle(x, hex) {                   // 召喚陣：兩圈發光細環，從腳下擴散
  const y = laneY(x) + 0.03;
  for (const [s, life] of [[1.5, 1.1], [1.0, 0.9]]) {
    const e = mesh('torus', hex, 1, true, 0.8);
    e.setPosition(x, y, LANE_Z);
    fx.push({ e, ring: true, life, max: life, s });
  }
  burst(x, y + 0.1, hex, 18, 1.2, 0.05, 1.0, true, 1.6);
}
function updateFx(dt) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const p = fx[i];
    p.life -= dt;
    if (p.life <= 0) { p.e.destroy(); fx.splice(i, 1); continue; }
    const k = p.life / p.max;
    if (p.ring) {
      const s = p.s * (1.15 - 0.35 * k);
      p.e.setLocalScale(s, 0.03, s);
      p.e.rotateLocal(0, 140 * dt, 0);
    } else {
      p.v.mulScalar(Math.pow(p.drag, dt * 30));
      const q = p.e.getPosition();
      p.e.setPosition(q.x + p.v.x * dt, q.y + p.v.y * dt, q.z + p.v.z * dt);
      const s = p.s * k;
      p.e.setLocalScale(s, s, s);
    }
  }
}

// ---------------------------------------------------------------- 聲音（Web Audio：音效、配音、配樂）
// 瀏覽器規定要等玩家第一次按鍵／點擊才能出聲，所以在第一次輸入時才建立 AudioContext 並載入
const AU = { ctx: null, buf: {}, bus: {}, music: null, musicKey: null, wantMusic: 'bgm_select', last: {}, muted: false, ready: false };
const SFX_FILES = ['hit_light', 'hit_heavy', 'block', 'guard_break', 'whoosh', 'dodge', 'jump_land', 'summon', 'swap', 'ult_start', 'tiger_roar',
  'foxfire', 'wind_gust', 'ice', 'blizzard', 'leaves', 'chicken_yuck', 'talisman', 'crowd_cheer', 'menu_click', 'fog', 'round_start', 'ko_gong'];
const MUSIC_FILES = ['bgm_select', 'bgm_temple', 'bgm_noh'];
const VOICE_FILES = [...Object.keys(TAUNTS).flatMap(k => { const [tw, jp] = k.split('|'); return [`taunt_${tw}_${jp}_tw`, `taunt_${tw}_${jp}_jp`]; }),
  ...Object.keys(ROSTER).map(k => 'ult_' + k), 'narr_round_start', 'narr_ko', 'narr_select'];
const MUSIC_VOL = 0.4;
const musicLevel = () => MUSIC_VOL * S.music / 100;   // 設定裡的配樂音量（S 在「介面」區塊）
function audioInit() {
  if (AU.ctx) { if (AU.ctx.state === 'suspended') AU.ctx.resume(); return; }
  const ctx = AU.ctx = new AudioContext();
  const master = ctx.createGain(); master.gain.value = S.muted ? 0 : 1; master.connect(ctx.destination); AU.bus.master = master;
  for (const [k, v] of [['music', musicLevel()], ['sfx', 0.85 * S.sfx / 100], ['voice', S.voice / 100]]) { const g = ctx.createGain(); g.gain.value = v; g.connect(master); AU.bus[k] = g; }
  const load = async (key, url) => { try { const r = await fetch(url); AU.buf[key] = await ctx.decodeAudioData(await r.arrayBuffer()); } catch (e) { console.warn('audio', key, e); } };
  Promise.all([
    ...SFX_FILES.map(n => load('sfx:' + n, A + 'sfx/' + n + '.mp3')),
    ...MUSIC_FILES.map(n => load('music:' + n, A + 'music/' + n + '.mp3')),
    ...VOICE_FILES.map(n => load('voice:' + n, A + 'voice/' + n + '.mp3')),
  ]).then(() => { AU.ready = true; const w = AU.wantMusic; AU.musicKey = null; playMusic(w); });
}
const audioOn = () => AU.ctx && AU.ctx.state === 'running';
function sfx(name, vol = 1, minGap = 0.05) {
  const b = AU.buf['sfx:' + name];
  if (!audioOn() || !b) return;
  const now = AU.ctx.currentTime;
  if (AU.last[name] && now - AU.last[name] < minGap) return;
  AU.last[name] = now;
  const src = AU.ctx.createBufferSource(); src.buffer = b; src.playbackRate.value = 0.94 + Math.random() * 0.12;
  const g = AU.ctx.createGain(); g.gain.value = vol;
  src.connect(g); g.connect(AU.bus.sfx); src.start();
}
function voice(names) {                              // 依序播放幾句配音，播放期間配樂自動壓低
  if (!audioOn()) return;
  const ctx = AU.ctx, now = ctx.currentTime;
  let t = now + 0.05;
  for (const n of names) {
    const b = AU.buf['voice:' + n]; if (!b) continue;
    const src = ctx.createBufferSource(); src.buffer = b; src.connect(AU.bus.voice); src.start(t); t += b.duration + 0.25;
  }
  const mg = AU.bus.music.gain;
  mg.cancelScheduledValues(now); mg.setTargetAtTime(musicLevel() * 0.35, now, 0.1); mg.setTargetAtTime(musicLevel(), t, 0.4);
}
function playMusic(key) {                            // 換曲時淡出舊的、淡入新的
  AU.wantMusic = key;
  if (!audioOn() || AU.musicKey === key) return;
  const b = AU.buf['music:' + key]; if (!b) return;
  const ctx = AU.ctx, now = ctx.currentTime;
  if (AU.music) { const old = AU.music; old.g.gain.setTargetAtTime(0, now, 0.4); old.src.stop(now + 2.5); }
  const src = ctx.createBufferSource(); src.buffer = b; src.loop = true;
  const g = ctx.createGain(); g.gain.value = 0; g.gain.setTargetAtTime(1, now, 0.6);
  src.connect(g); g.connect(AU.bus.music); src.start();
  AU.music = { src, g }; AU.musicKey = key;
}
function toggleMute() { S.muted = !S.muted; saveSettings(); applyAudio(); callout(S.muted ? '靜音' : '聲音開啟', 0.6); }
const SHOT_SFX = { foxfire: ['foxfire', 1], storm: ['foxfire', 0.45], chicken: ['whoosh', 0.8], gust: ['wind_gust', 0.9], tornado: ['wind_gust', 1], debt: ['leaves', 1], frost: ['ice', 0.9], spike: ['leaves', 1] };

// ---------------------------------------------------------------- 遊戲狀態
const G = { log: [], state: 'loading', stage: 'temple', time: 99, timeScale: 1, hitstop: 0, shake: 0, debug: false, freeCam: false,
  teams: [], shots: [], seq: null, winner: null, introT: 0, endT: 0, botP1: false, fogT: 0, stormT: 0, pause: false,
  sel: { side: 0, lead: 0, stage: 'temple', diff: 1 }, summoners: [], punch: 0, focus: null };
const laneY = x => sampleProfile(ENV[G.stage].lane, x);
const arenaX = () => STAGES[G.stage].arenaX;

function makeFighter(key, team) {
  const def = ROSTER[key];
  const c = CH[def.file];
  c.setScale(def.scale, def.scale, def.scale);
  if (def.alt) CH[def.alt].setScale(def.scale, def.scale, def.scale);
  return { key, def, team, base: c, c, file: def.file, hp: 100, hpLag: 100, guard: 100, meter: 0, x: 0, y: 0, vy: 0, facing: 1,
    st: 'out', stT: 0, mv: null, hit: false, inv: 0, stunT: 0, react: null, cd: { spec: 0, tal: 0, swap: 0 },
    rev: 0, reversed: 0, slowT: 0, freezeT: 0, debt: 0, enterT: 1.2, flashT: 0, flashCol: null, combo: 0, comboT: 0, comboVictim: null, clip: null, loop: false, walk: 'walkF', dead: false,
    hw: 0.3 * def.scale, h: 1.72 * def.scale, ai: null };
}
const active = t => G.teams[t].members[G.teams[t].cur];
const opp = f => active(1 - f.team);

function setState(f, st) {
  if (f.st === 'frozen' && st !== 'frozen') f.c.setTint(0);
  f.st = st; f.stT = 0; f.hit = false;
}
function setPose(f, clip, frac) {
  if (f.clip !== clip || f.loop) { f.c.playAnimation(clip, { loop: false, rootMotion: false }); f.clip = clip; f.loop = false; }
  f.c.playbackSpeed = 0;
  f.c.animationTime = clamp(frac, 0, 0.999) * DUR[clip];
}
function loopAnim(f, clip, speed = 1) {
  if (f.clip !== clip || !f.loop) { f.c.crossfadeTo(clip, { duration: 0.14, loop: true, rootMotion: false }); f.clip = clip; f.loop = true; }
  f.c.playbackSpeed = G.hitstop > 0 ? 0 : G.timeScale * speed;
}
// 迴旋踢的原始動作是往鏡頭方向踢（約偏 70 度），出腿時讓身體順勢轉過去，腳才會掃到對手
function moveYaw(f) {
  if (f.st !== 'attack' || !f.mv || !f.mv.yaw) return 0;
  const frac = lerp(f.mv.seg[0], f.mv.seg[1], Math.min(1, f.stT / f.mv.time));
  const ss = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  return f.mv.yaw * (ss(0.12, 0.3, frac) - ss(0.52, 0.75, frac));
}
function syncTransform(f) {
  f.c.setPosition(f.x, laneY(f.x) + f.y, LANE_Z);
  f.c.setRotation(0, (f.facing > 0 ? 0 : 180) + moveYaw(f), 0);
}
function swapBody(f, file) {                      // 虎姑婆變身：換成另一個潑濺角色，骨架相同所以動作照接
  const next = CH[file];
  f.c.setActive(false);
  next.setActive(true);
  next.setReveal(1);
  f.c = next; f.file = file; f.clip = null;
  syncTransform(f);
}

// ---------------------------------------------------------------- 召喚師與觀眾
function setupSidelines() {
  for (const n of ['ahue', 'saku']) CH[n].setActive(false);
  G.summoners = G.teams.map((t, i) => {
    const file = SIDES[t.side].summoner, c = CH[file];
    const x = (i === 0 ? -1 : 1) * Math.min(arenaX() + 0.4, 3.2);      // 站在畫面兩側邊緣，鏡頭拍得到
    c.setActive(true); c.setReveal(1);
    c.setScale(file === 'saku' ? 0.97 : 1, file === 'saku' ? 0.97 : 1, file === 'saku' ? 0.97 : 1);
    c.setPosition(x, sampleProfile(ENV[G.stage].back, x), SUMMONER_Z);
    c.setRotation(0, i === 0 ? -35 : 215, 0);
    return { c, file, clip: null, loop: false, act: null, actT: 0, actDur: 0, summonClip: 'summon_' + file };
  });
  const xs = [-3.9, -3.2, -2.5, 2.5, 3.2, 3.9];                          // 觀眾在後方兩側，不搶戰鬥角色的焦點
  crowd.forEach((g, i) => {
    const x = xs[i] * (arenaX() / 3.0);
    g.c.setActive(true);
    g.c.setOpacity(0.38);
    g.c.setTint(0.35, { r: 0.6, g: 0.78, b: 1 });
    g.c.setPosition(x, sampleProfile(ENV[G.stage].lane, x), STAGES[G.stage].crowdZ - 0.4 - (i % 2) * 0.45);   // 後排地面常被椅子、台階墊高，改用戰鬥線的地面高度
    g.c.setRotation(0, -90 + (x < 0 ? 25 : -25), 0);
    g.clip = null; g.seeded = false; g.cheerT = 0;
  });
}
function summonerDo(team, clip, dur) {
  const s = G.summoners[team];
  if (s) { s.act = clip; s.actT = 0; s.actDur = dur; }
}
function cheer(t = 1.6) { for (const g of crowd) g.cheerT = Math.max(g.cheerT, t * (0.7 + Math.random() * 0.6)); sfx('crowd_cheer', 0.45, 1.5); }
function updateSidelines(dt) {
  for (const s of G.summoners) {
    if (s.act) {
      s.actT += dt;
      setPose(s, s.act, s.actT / s.actDur);
      if (s.actT >= s.actDur) s.act = null;
    } else loopAnim(s, 'stand');
  }
  for (const g of crowd) {
    g.cheerT = Math.max(0, g.cheerT - dt);
    loopAnim(g, g.cheerT > 0 ? 'cheer' : 'clap', 0.9 + 0.1 * (g.slot % 3));
    if (!g.seeded) { g.c.animationTime = Math.random() * DUR.clap; g.seeded = true; }
  }
}

// ---------------------------------------------------------------- HUD
const picUrl = key => `url(img/portraits/${ROSTER[key].pic}.jpg)`;   // 512px 小圖（原圖在 art/pinoc_inputs，1MB 一張太大）
function hudSetup() {
  for (const t of [0, 1]) {
    const team = G.teams[t], side = team.side;
    $('bench' + t).innerHTML = team.members.map((m, i) => `<span id="bench${t}_${i}" style="background-image:${picUrl(m.key)}"></span>`).join('');
    $('tal' + t).className = 'talisman ' + side;
    $('tal' + t).querySelector('span').textContent = SIDES[side].talCard;
    $('m' + t).parentElement.className = 'meter ' + side;
  }
}
function hud() {
  for (const t of [0, 1]) {
    const f = active(t), team = G.teams[t];
    $('pt' + t).style.backgroundImage = picUrl(f.key);
    $('name' + t).textContent = f.def.name + (f.file !== f.def.file ? '（現形）' : '');
    f.hpLag = f.hpLag > f.hp ? Math.max(f.hp, f.hpLag - 40 * (1 / 60)) : f.hp;
    $('hp' + t).style.transform = `scaleX(${clamp(f.hp / 100, 0, 1)})`;
    $('hpLag' + t).style.transform = `scaleX(${clamp(f.hpLag / 100, 0, 1)})`;
    $('g' + t).style.transform = `scaleX(${clamp(f.guard / 100, 0, 1)})`;
    $('g' + t).parentElement.classList.toggle('broken', f.st === 'stun');
    const m = clamp(f.meter, 0, 100);
    $('m' + t).style.transform = `scaleX(${m / 100})`;
    $('m' + t).parentElement.classList.toggle('full', m >= 100);
    $('mLabel' + t).textContent = m >= 100 ? (t === 0 && !document.body.classList.contains('touch') ? '奧義可用（I）' : '奧義可用') : `靈力 ${Math.floor(m)}%`;
    $('talCd' + t).style.transform = `scaleY(${clamp(f.cd.tal / 15, 0, 1)})`;
    $('tal' + t).classList.toggle('cd', f.cd.tal > 0);
    team.members.forEach((mm, i) => { const el = $(`bench${t}_${i}`); if (el) { el.classList.toggle('dead', mm.dead); el.style.outline = i === team.cur ? '2px solid #fff6' : 'none'; } });
    // 頭上狀態圖示
    const icons = [];
    if (f.debt > 0) icons.push('<b class="debt">債</b>');
    if (f.st === 'frozen') icons.push('<b class="frozen">冰</b>'); else if (f.slowT > 0) icons.push('<b class="slow">凍</b>');
    if (f.reversed > 0) icons.push('<b class="lost">迷</b>');
    if (f.inv > 0.6 && f.st !== 'enter' && f.st !== 'getup') icons.push('<b class="guard">護</b>');
    const tag = $('tag' + t);
    tag.innerHTML = icons.join('');
    if (icons.length) {
      const p = cam.camera.worldToScreen(new pc.Vec3(f.x, laneY(f.x) + f.y + f.h + 0.2, LANE_Z), new pc.Vec3());
      tag.style.left = p.x + 'px'; tag.style.top = p.y + 'px';        // worldToScreen 回傳的就是 CSS 像素
    }
  }
  for (const t of [0, 1]) {
    const f = active(t), el = $('combo' + t);
    if (f.combo >= 2 && f.comboT > 0) { el.textContent = f.combo + ' 連段！'; el.classList.add('on'); } else el.classList.remove('on');
  }
  $('timer').textContent = Math.max(0, Math.ceil(G.time));
  touchHud();
  if (G.debug) {
    $('debug').textContent = [0, 1].map(t => { const f = active(t); return `${f.def.name} ${f.st.padEnd(7)} x=${f.x.toFixed(2)} hp=${f.hp.toFixed(0)} g=${f.guard.toFixed(0)} m=${f.meter.toFixed(0)} inv=${f.inv.toFixed(2)} slow=${f.slowT.toFixed(1)} debt=${f.debt.toFixed(1)}`; }).join('\n')
      + `\n${G.state} ${G.stage} t=${G.time.toFixed(1)} scale=${G.timeScale} shots=${G.shots.length} fx=${fx.length}`;
  }
}
let calloutTimer = 0, bannerTimer = 0, subTimer = 0;
function callout(text, t = 1.1) { const e = $('callout'); e.textContent = text; e.classList.add('on'); calloutTimer = t; }
function banner(text, side, t = 1.6) { const e = $('banner'); e.textContent = text; e.className = 'on ' + (side || ''); bannerTimer = t; }
function subtitle(html, t = 3) { const e = $('subtitle'); e.innerHTML = html; e.classList.add('on'); subTimer = t; }
function flash(op = 0.6) { const e = $('flash'); e.style.transition = 'none'; e.style.opacity = op; requestAnimationFrame(() => { e.style.transition = 'opacity .25s'; e.style.opacity = 0; }); }
function overlays(dt) {
  if ((calloutTimer -= dt) <= 0) $('callout').classList.remove('on');
  if ((bannerTimer -= dt) <= 0) $('banner').classList.remove('on');
  if ((subTimer -= dt) <= 0) $('subtitle').classList.remove('on');
  if (G.fogT > 0 && (G.fogT -= dt) <= 0) $('fog').style.opacity = 0;
  if (G.stormT > 0 && (G.stormT -= dt) <= 0) $('snow').classList.remove('storm');
}

// ---------------------------------------------------------------- 判定
const tmpPos = new Float32Array(12);
function bonePositions(f, names, frame) {
  const idx = names.map(n => BONE[f.file][n]).filter(i => i >= 0);
  const ok = f.c.armature.probeBoneWorldPositions(frame, idx, tmpPos);
  if (!ok) return null;
  const out = [];
  for (let i = 0; i < idx.length; i++) out.push([tmpPos[3 * i], tmpPos[3 * i + 1]]);
  return out;
}
function touches(att, def, pts, reach) {
  if (Math.sign(def.x - att.x) !== att.facing && Math.abs(def.x - att.x) > 0.1) return false;
  const base = laneY(def.x) + def.y;
  if (pts) return pts.some(([bx, by]) => Math.abs(bx - def.x) < def.hw + 0.08 && by > base + 0.05 && by < base + def.h);
  return Math.abs(def.x - att.x) < reach;         // 讀不到骨頭時的退路
}
function vulnerable(f) { return f.inv <= 0 && !['ko', 'knock', 'getup', 'enter', 'out', 'win'].includes(f.st); }

function applyHit(att, def, mv) {
  if (!vulnerable(def)) return false;
  const toward = Math.sign(att.x - def.x) || -att.facing;
  const blocking = def.st === 'block' && def.facing === toward && !mv.unblockable;
  const hy = laneY(def.x) + def.y + def.h * 0.62;
  const ax = arenaX();
  if (blocking) {
    def.guard -= mv.guard || 10;
    def.hp -= mv.dmg * 0.15;
    def.x = clamp(def.x - toward * (mv.push || 0.3) * 0.6, -ax, ax);
    burst(def.x + toward * def.hw, hy, '#ffd35a', 8, 2, 0.05, 0.3);
    def.meter = Math.min(100, def.meter + 4);
    G.hitstop = 0.04;
    def.flashT = 0.07; def.flashCol = { r: 1, g: 0.8, b: 0.3 };
    sfx('block');
    if (def.guard <= 0) { def.guard = 0; setState(def, 'stun'); def.stunT = 1.2; callout('破防', 0.8); G.shake = 0.15; sfx('guard_break'); }
    return true;
  }
  if (att.comboT > 0 && att.comboVictim === def) att.combo++; else att.combo = 1;
  att.comboT = 1.1; att.comboVictim = def;
  const scale = Math.max(0.6, 1 - 0.1 * (att.combo - 1));                // 連段越長，每下傷害遞減
  const dmg = mv.dmg * scale * (def.debt > 0 ? 1.3 : 1);
  def.hp -= dmg;
  G.log.push(`${att.def.name}→${def.def.name} ${dmg.toFixed(0)}${mv.unblockable ? '!' : ''}${def.debt > 0 ? '債' : ''}`);
  if (mv.heal) att.hp = Math.min(100, att.hp + mv.heal);
  if (mv.mark) def.debt = mv.mark;
  if (mv.slow) def.slowT = mv.slow;
  att.meter = Math.min(100, att.meter + (mv.meter ?? 6));
  def.meter = Math.min(100, def.meter + 4);
  def.x = clamp(def.x - toward * (mv.push || 0.3), -ax, ax);
  burst(def.x + toward * def.hw * 0.6, hy, mv.color || '#ff5a3a', 12, 3.2, 0.05, 0.38, false);   // 不用加色混合，顏色才不會被背景洗成白
  burst(def.x + toward * def.hw * 0.6, hy, '#fff3c0', 6, 4, 0.03, 0.22);
  def.flashT = 0.1; def.flashCol = { r: 1, g: 0.32, b: 0.22 };
  if (mv.react === 'knock' || mv.dmg >= 12) G.punch = Math.max(G.punch, 0.35);
  G.hitstop = mv.react === 'knock' ? 0.11 : 0.07;
  sfx(mv.react === 'knock' || mv.dmg >= 12 ? 'hit_heavy' : 'hit_light');
  if (mv.stun && mv.text === '嘔～') sfx('chicken_yuck');
  if (mv.freeze) sfx('ice');
  G.shake = Math.max(G.shake, mv.react === 'knock' ? 0.22 : 0.1);
  if (mv.react === 'knock' || mv.dmg >= 12) cheer(1.4);
  if (mv.freeze) { setState(def, 'frozen'); def.freezeT = mv.freeze; def.c.setTint(0.65, ICE); }
  else if (mv.stun) { setState(def, 'stun'); def.stunT = mv.stun; }
  else if (mv.react === 'knock' || def.y > 0.05 || att.combo >= 5) { setState(def, 'knock'); if (att.combo >= 5) att.comboT = 0; }   // 第 5 下強制擊倒，避免無限連段
  else { setState(def, 'hit'); def.react = REACT[mv.react] || REACT.hitL; }
  if (mv.lift) { def.vy = mv.lift; def.y = Math.max(def.y, 0.01); }
  if (mv.text) callout(mv.text, 0.7);
  if (def.hp <= 0) { def.hp = 0; ko(def); }
  return true;
}

// ---------------------------------------------------------------- 飛行道具
const SHOTS = {
  foxfire: { hex: '#5aa8ff', r: 0.18, v: 6.5, dmg: 8, react: 'hitL', meter: 7, push: 0.3, color: '#7fc4ff' },
  chicken: { hex: '#c2732e', r: 0.13, v: 5.2, dmg: 5, react: 'hitH', stun: 1.0, meter: 6, push: 0.1, color: '#e0a060', text: '嘔～', add: false },
  gust: { hex: '#8fc8e8', r: 0.34, v: 4.4, dmg: 5, react: 'hitL', meter: 6, push: 1.5, color: '#eaffff', op: 0.3 },
  storm: { hex: '#6fb8ff', r: 0.16, v: 7.2, dmg: 4, react: 'hitL', meter: 2, push: 0.12, color: '#9fd8ff' },
  tornado: { hex: '#9fd0ea', r: 0.6, v: 5.0, dmg: 20, react: 'knock', meter: 0, push: 0.8, color: '#ffffff', op: 0.35, lift: 5.5, unblockable: true, hy: 0.45 },
  debt: { hex: '#4fbf5a', r: 0.12, v: 6.2, dmg: 6, react: 'hitL', meter: 7, push: 0.2, color: '#7fe08a', mark: 6, text: '債！' },
  frost: { hex: '#7fc0e8', r: 0.26, v: 4.2, life: 0.75, dmg: 5, react: 'hitL', meter: 6, push: 0.1, color: '#e6f7ff', slow: 3, op: 0.45, text: '凍' },
  spike: { hex: '#3f9f4a', r: 0.2, v: 7.5, dmg: 6, react: 'hitH', meter: 0, push: 0.2, color: '#7fe08a', add: false, hy: 0.0, cone: true },
};
function shoot(f, kind, over = {}) {
  const S = { ...SHOTS[kind], ...over };
  const g = laneY(f.x) + f.y;
  const y = g + f.h * (S.hy ?? 0.62) + (kind === 'storm' ? (Math.random() - 0.5) * 0.6 : 0);
  const e = S.cone ? mesh('cone', S.hex, 1, false) : mesh('sphere', S.hex, S.r * 2, S.add !== false, S.op || 1);
  if (S.cone) e.setLocalScale(0.28, 0.75, 0.28);
  const x = f.x + f.facing * 0.45;
  e.setPosition(x, S.cone ? laneY(x) + 0.3 : y, LANE_Z);
  G.shots.push({ e, x, y, vx: f.facing * S.v, owner: f, mv: S, life: S.life || 2.2 });
  const ss = SHOT_SFX[kind]; if (ss) sfx(ss[0], ss[1], kind === 'storm' ? 0.08 : 0.05);
}
function updateShots(dt) {
  for (let i = G.shots.length - 1; i >= 0; i--) {
    const s = G.shots[i];
    s.x += s.vx * dt; s.life -= dt;
    if (s.mv.cone) {
      s.e.setPosition(s.x, laneY(s.x) + 0.3, LANE_Z);
      if (Math.random() < dt * 30) burst(s.x, laneY(s.x) + 0.1, '#6fd07a', 2, 1.4, 0.05, 0.4, true, 1.2);
    } else { s.e.setPosition(s.x, s.y, LANE_Z); s.e.rotateLocal(0, 0, 400 * dt); }
    const d = opp(s.owner), base = laneY(d.x) + d.y;
    const hy = s.mv.cone ? base + 0.4 : s.y;
    const hit = Math.abs(s.x - d.x) < d.hw + s.mv.r && hy > base - 0.1 && hy < base + d.h + s.mv.r;
    if (hit && applyHit(s.owner, d, s.mv)) { burst(s.x, hy, s.mv.color, 10, 2.5, 0.06, 0.35); s.life = 0; }
    if (s.life <= 0 || Math.abs(s.x) > arenaX() + 2) { s.e.destroy(); G.shots.splice(i, 1); }
  }
}

// ---------------------------------------------------------------- 動作
const free = f => ['idle', 'walk', 'block'].includes(f.st) && !G.seq;
function tryAction(f, a) {
  if (a === 'light' || a === 'heavy' || a === 'kick') { f.mv = MOVES[a]; setState(f, 'attack'); sfx('whoosh', a === 'heavy' ? 0.9 : 0.6); return true; }
  if (a === 'special') {
    if (f.cd.spec > 0) return false;
    f.cd.spec = 2.4; setState(f, 'special');
    callout(f.def.spec.name, 0.6);
    return true;
  }
  if (a === 'ult') { if (f.meter < 100) return false; startUlt(f); return true; }
  if (a === 'dodge') { setState(f, 'dodge'); f.inv = 0.5; sfx('dodge'); return true; }
  if (a === 'jump') { setState(f, 'jump'); f.vy = 4.2; f.y = 0.01; sfx('whoosh', 0.4); return true; }
  if (a === 'talisman') {
    if (f.cd.tal > 0) return false;
    const side = G.teams[f.team].side;
    f.cd.tal = 15; f.inv = 2.0;
    burst(f.x, laneY(f.x) + 1, side === 'tw' ? '#ffd35a' : '#cfe6ff', 24, 1.5, 0.05, 0.9, true, 0.8);
    callout(SIDES[side].tal, 0.7);
    summonerDo(f.team, 'cast', 0.9);
    sfx('talisman');
    return true;
  }
  if (a === 'swap') return trySwap(f.team);
  return false;
}
function control(f, it, dt) {
  if (f.reversed > 0) it.move = -it.move;
  if (!free(f)) return;
  if (it.act && tryAction(f, it.act)) { if (it.human) INBUF.t = 0; return; }
  if (it.block) { if (f.st !== 'block') setState(f, 'block'); return; }
  if (f.st === 'block') setState(f, 'idle');
  if (it.move) {
    const fwd = it.move === f.facing;
    f.x = clamp(f.x + it.move * (fwd ? WALK_F : WALK_B) * dt, -arenaX(), arenaX());
    f.walk = fwd ? 'walkF' : 'walkB';
    if (f.st !== 'walk') setState(f, 'walk');
  } else if (f.st === 'walk') setState(f, 'idle');
}

function updateFighter(f, dt) {
  const o = opp(f), ax = arenaX();
  f.stT += dt;
  f.inv = Math.max(0, f.inv - dt);
  if (f.flashT > 0) {                                     // 受擊閃光：短暫上色，結束後恢復（冰封則回到冰藍）
    f.flashT -= dt;
    if (f.flashT > 0) f.c.setTint(0.6, f.flashCol); else f.c.setTint(f.st === 'frozen' ? 0.65 : 0, ICE);
  }
  if (f.comboT > 0) f.comboT -= dt;
  for (const k in f.cd) f.cd[k] = Math.max(0, f.cd[k] - dt);
  if (f.st !== 'stun' && f.st !== 'block') f.guard = Math.min(100, f.guard + 9 * dt);
  if (['idle', 'walk', 'block'].includes(f.st) && Math.abs(o.x - f.x) > 0.05) f.facing = Math.sign(o.x - f.x);
  if (f.st !== 'jump' && f.st !== 'knock' && f.y > 0) { f.y = Math.max(0, f.y + f.vy * dt); f.vy -= GRAV * dt; }

  switch (f.st) {
    case 'enter': {                                        // 召喚登場：從腳下顯現，同時播專屬登場動作
      f.rev = Math.min(1, f.stT / 0.7);
      f.c.setReveal(f.rev);
      setPose(f, 'enter_' + f.key, Math.min(1, f.stT / f.enterT));
      if (f.stT >= f.enterT) setState(f, 'idle');
      break;
    }
    case 'idle': loopAnim(f, 'idle'); break;
    case 'walk': loopAnim(f, f.walk); break;
    case 'block': setPose(f, 'block', Math.min(0.35, f.stT * 3)); break;
    case 'win': loopAnim(f, 'win_' + f.key); break;
    case 'frozen': {
      f.c.playbackSpeed = 0;
      if (Math.random() < dt * 8) burst(f.x, laneY(f.x) + f.h * Math.random(), '#e6f7ff', 1, 0.5, 0.04, 0.5);
      if (f.stT >= f.freezeT) setState(f, 'idle');
      break;
    }
    case 'attack': {
      const mv = f.mv, p = f.stT / mv.time, frac = lerp(mv.seg[0], mv.seg[1], Math.min(1, p));
      setPose(f, mv.clip, frac);
      if (frac > mv.act[0] - 0.08 && frac < mv.act[1]) f.x = clamp(f.x + f.facing * mv.lunge * dt / (mv.time * 0.3), -ax, ax);
      if (!f.hit && frac >= mv.act[0] && frac <= mv.act[1]) {
        const pts = bonePositions(f, mv.bones, frac * DUR[mv.clip]);
        if (touches(f, o, pts, 1.0) && applyHit(f, o, mv)) f.hit = true;
      }
      if (p >= 1) setState(f, 'idle');
      break;
    }
    case 'special': specialStep(f, o, dt); break;
    case 'dodge': {
      const p = f.stT / 0.6;
      setPose(f, 'dodge', p);
      f.x = clamp(f.x + f.facing * 1.5 * dt / 0.6, -ax, ax);
      if (p >= 1) { setState(f, 'idle'); f.inv = 0.08; }
      break;
    }
    case 'jump': {
      f.y += f.vy * dt; f.vy -= GRAV * dt;
      setPose(f, 'jump', 0.18 + 0.6 * Math.min(1, f.stT / 0.7));
      if (f.y <= 0 && f.stT > 0.1) { f.y = 0; setState(f, 'idle'); sfx('jump_land', 0.7); }
      break;
    }
    case 'hit': {
      const r = f.react || REACT.hitL, p = f.stT / r.time;
      setPose(f, r.clip, lerp(r.seg[0], r.seg[1], Math.min(1, p)));
      if (p >= 1) setState(f, 'idle');
      break;
    }
    case 'stun': {
      setPose(f, 'hitH', 0.45 + 0.05 * Math.sin(f.stT * 10));
      if (Math.random() < dt * 6) burst(f.x, laneY(f.x) + f.y + f.h + 0.1, '#ffe36a', 1, 0.6, 0.04, 0.5);
      if (f.stT >= f.stunT) { setState(f, 'idle'); f.guard = Math.max(f.guard, 45); }
      break;
    }
    case 'knock': {
      if (f.y > 0 || f.vy > 0) { f.y = Math.max(0, f.y + f.vy * dt); f.vy -= GRAV * dt; }
      setPose(f, 'knock', Math.min(1, f.stT / 1.0));
      if (f.stT >= 1.0 && f.y <= 0) setState(f, 'getup');
      break;
    }
    case 'getup': {
      setPose(f, 'getup', Math.min(1, f.stT / 1.0));
      if (f.stT >= 1.0) { setState(f, 'idle'); f.inv = 0.35; }
      break;
    }
    case 'ko': {
      if (f.y > 0 || f.vy > 0) { f.y = Math.max(0, f.y + f.vy * dt); f.vy -= GRAV * dt; }
      setPose(f, 'ko', Math.min(1, f.stT / 1.4));
      break;
    }
    case 'ult': break;                                   // 由 runSeq 控制
  }
}

function specialStep(f, o, dt) {
  const k = f.def.spec.kind;
  if (k === 'bite') {                                      // 虎姑婆：咬手指（近身偷血）
    const mv = { clip: 'light', seg: [0.25, 0.85], act: [0.45, 0.66], time: 0.5, dmg: 9, heal: 6, guard: 14, bones: ['hand_r', 'hand_l'], react: 'hitH', meter: 9, push: 0.15, lunge: 0.25, color: '#ff8a3a', text: '喀滋！' };
    const p = f.stT / mv.time, frac = lerp(mv.seg[0], mv.seg[1], Math.min(1, p));
    setPose(f, 'light', frac);
    if (frac > mv.act[0] - 0.1 && frac < mv.act[1]) f.x = clamp(f.x + f.facing * 0.9 * dt, -arenaX(), arenaX());
    if (!f.hit && frac >= mv.act[0] && frac <= mv.act[1]) {
      const pts = bonePositions(f, mv.bones, frac * DUR.light);
      if (touches(f, o, pts, 1.0) && applyHit(f, o, mv)) f.hit = true;
    }
    if (p >= 1) setState(f, 'idle');
    return;
  }
  const clip = (k === 'chicken' || k === 'debt') ? 'throw' : 'cast', T = 0.7, p = f.stT / T;
  setPose(f, clip, lerp(0.1, 0.9, Math.min(1, p)));
  if (!f.hit && p >= 0.45) { f.hit = true; shoot(f, k); }
  if (p >= 1) setState(f, 'idle');
}

// ---------------------------------------------------------------- 奧義
const ULT_TIME = { tiger: 2.7, foxstorm: 1.8, tornado: 1.7, lost: 1.5, pandanus: 2.0, blizzard: 1.7 };
function startUlt(f) {
  const o = opp(f), side = G.teams[f.team].side;
  f.meter = 0;
  setState(f, 'ult');
  G.seq = { f, o, kind: f.def.ult.kind, t: 0, marks: {} };
  G.log.push('ULT ' + f.def.ult.name);
  G.focus = { x: f.x, t: 0.9, amt: 0.9 };
  banner(f.def.ult.name, side === 'jp' ? 'jp' : '');
  sfx('ult_start'); voice(['ult_' + f.key]);
  $('dim').style.opacity = 0.85;
  ENV[G.stage].env.setTint(0.55, { r: 0.04, g: 0.03, b: 0.12 });
  summonerDo(f.team, 'cast', 1.0);
  flash(0.35);
}
function endSeq() {
  const { f } = G.seq;
  G.seq = null;
  $('dim').style.opacity = 0;
  ENV[G.stage].env.setTint(0);
  if (f.st === 'ult') setState(f, 'idle');
}
function once(s, k, at) { if (s.t >= at && !s.marks[k]) { s.marks[k] = true; return true; } return false; }
function ultPose(f, s, t0, T) { setPose(f, 'ult_' + f.key, clamp((s.t - t0) / T, 0, 1)); }
function runSeq(dt) {
  const s = G.seq, f = s.f, o = s.o, ax = arenaX();
  s.t += dt;
  if (s.kind === 'tiger') {                                // 虎姑婆：現出原形，撲擊兩下
    if (s.t < 0.45) loopAnim(f, 'idle');
    if (once(s, 'swap', 0.45)) { smoke(f.x, laneY(f.x), 1.2); swapBody(f, f.def.alt); G.shake = 0.25; flash(0.5); sfx('tiger_roar'); }
    if (s.t >= 0.45 && s.t < 2.15) ultPose(f, s, 0.5, 1.65);
    if (s.t >= 0.7 && s.t < 1.1) f.x = lerp(f.x, clamp(o.x - f.facing * 0.75, -ax, ax), Math.min(1, dt * 10));
    if (once(s, 'hit0', 1.25)) { applyHit(f, o, { dmg: 12, guard: 0, react: 'hitH', meter: 0, push: 0.25, unblockable: true, color: '#ff7b2a' }); o.inv = 0; }
    if (once(s, 'hit1', 1.85)) applyHit(f, o, { dmg: 18, guard: 0, react: 'knock', meter: 0, push: 0.7, unblockable: true, color: '#ff7b2a', text: '喀滋！！' });
    if (once(s, 'back', 2.4)) { smoke(f.x, laneY(f.x), 1.0); swapBody(f, f.def.file); }
    if (s.t >= 2.4) loopAnim(f, 'idle');
  } else if (s.kind === 'foxstorm') {                      // 九尾狐：九發狐火
    ultPose(f, s, 0, 1.6);
    for (let i = 0; i < 9; i++) if (once(s, 'f' + i, 0.35 + i * 0.1)) shoot(f, 'storm');
  } else if (s.kind === 'tornado') {                       // 天狗：龍捲風把人捲上天
    ultPose(f, s, 0, 1.5);
    if (once(s, 'gust', 1.2)) shoot(f, 'tornado');
  } else if (s.kind === 'lost') {                          // 魔神仔：起霧、方向鍵反轉
    ultPose(f, s, 0, 1.4);
    if (once(s, 'fog', 0.8)) {
      $('fog').style.opacity = 1; G.fogT = 3.6; sfx('fog');
      o.reversed = 3.6;
      applyHit(f, o, { dmg: 8, guard: 0, react: 'hitH', meter: 0, push: 0.2, unblockable: true, color: '#9fe0a0', text: '迷路了…' });
    }
  } else if (s.kind === 'pandanus') {                      // 林投姐：林投葉尖刺分三波竄出
    ultPose(f, s, 0, 1.8);
    for (let i = 0; i < 3; i++) if (once(s, 'w' + i, 0.6 + i * 0.22)) shoot(f, 'spike', i === 2 ? { react: 'knock', dmg: 8, text: '還債！' } : {});
  } else if (s.kind === 'blizzard') {                      // 雪女：吹雪，冰封 2 秒
    ultPose(f, s, 0, 1.5);
    if (once(s, 'storm', 0.65)) {
      $('snow').classList.add('on', 'storm'); G.stormT = 2.4; sfx('blizzard');
      applyHit(f, o, { dmg: 16, guard: 0, react: 'hitL', meter: 0, push: 0.1, unblockable: true, color: '#e6f7ff', freeze: 2.0, text: '吹雪' });
    }
  }
  if (G.seq && s.t >= ULT_TIME[s.kind]) endSeq();
}

// ---------------------------------------------------------------- 回合流程
function enter(team, idx, x, enterT = 1.2) {
  const t = G.teams[team], f = t.members[idx];
  t.cur = idx;
  f.c = f.base; f.file = f.def.file;
  f.c.setActive(true);
  f.c.setTint(0);
  f.x = x; f.y = 0; f.vy = 0; f.facing = team === 0 ? 1 : -1; f.clip = null;
  f.enterT = enterT;
  f.c.setReveal(0);
  setState(f, 'enter'); f.inv = enterT + 0.1;
  syncTransform(f);
  summonCircle(x, SIDES[t.side].ring);
  summonerDo(team, G.summoners[team].summonClip, 1.6);
  sfx('summon', 0.8, 0.02);
  return f;
}
function trySwap(team) {
  const t = G.teams[team], f = active(team);
  const n3 = t.members.length;
  let j = -1;
  for (let k = 1; k < n3; k++) { const i = (t.cur + k) % n3; if (!t.members[i].dead) { j = i; break; } }   // 依序輪替到下一隻還活著的
  if (j < 0 || f.cd.swap > 0) return false;
  smoke(f.x, laneY(f.x), 0.8);
  sfx('swap');
  f.c.setActive(false);
  setState(f, 'out');
  const n = enter(team, j, f.x);
  n.cd.swap = 3;
  callout('召喚：' + n.def.name, 0.9);
  showTaunt();
  return true;
}
function ko(f) {
  setState(f, 'ko'); f.dead = true;
  G.log.push('KO ' + f.def.name);
  G.focus = { x: f.x, t: 1.5, amt: 1.3 };
  callout('K.O.', 1.4);
  G.hitstop = 0.18; G.shake = 0.3; flash(0.5);
  sfx('ko_gong');
  cheer(2.5);
  G.timeScale = 0.35; G.slowmoT = 0.7;   // 用遊戲時間倒數（setTimeout 在切分頁或快轉測試時會亂掉）
  if (G.seq && G.seq.f === f) endSeq();
}
function checkKO() {
  for (const t of [0, 1]) {
    const f = active(t);
    if (f.st === 'ko' && f.stT > 1.8) {
      const team = G.teams[t];
      const j = team.members.findIndex(m => !m.dead);
      if (j >= 0) {
        f.c.setActive(false); setState(f, 'out');
        const n = enter(t, j, clamp(f.x, -arenaX() + 0.6, arenaX() - 0.6));
        callout('召喚：' + n.def.name, 1.0);
        showTaunt();
      } else endRound(1 - t);
    }
  }
}
function showTaunt() {
  const a = active(0), b = active(1);
  const [tw, jp] = G.teams[0].side === 'tw' ? [a, b] : [b, a];
  const L = TAUNTS[tw.key + '|' + jp.key];
  if (L) { subtitle(`${tw.def.name}：「${L[0]}」<br>${jp.def.name}：「${L[1]}」<small>（${L[2]}）</small>`, 6.5); voice([`taunt_${tw.key}_${jp.key}_tw`, `taunt_${tw.key}_${jp.key}_jp`]); }
}
function endRound(winTeam) {
  if (G.state === 'end') return;
  G.state = 'end'; G.endT = 0; G.winner = winTeam;
  if (G.seq) endSeq();
  const w = active(winTeam);
  if (w.st !== 'ko') { if (w.file !== w.def.file) swapBody(w, w.def.file); setState(w, 'win'); }
  cheer(99);
  voice(['narr_ko']);
  banner(SIDES[G.teams[winTeam].side].label + '勝！', G.teams[winTeam].side === 'jp' ? 'jp' : '', 99);
}
function timeUp() {
  const tot = t => G.teams[t].members.reduce((s, m) => s + Math.max(0, m.hp), 0);
  callout('時間到', 1.2);
  endRound(tot(0) >= tot(1) ? 0 : 1);
}

function useStage(key) {
  if (!ENV[key]) { ensureStage(key).then(() => { if (G.sel.stage === key && G.state === 'select') useStage(key); }); return; }
  for (const [k, e] of Object.entries(ENV)) e.env.entity.enabled = k === key;
  G.stage = key;
  $('snow').className = STAGES[key].snow ? 'on' : '';
}
function startGame() {
  if (!ENV[G.sel.stage]) {                         // 選的擂台還在背景下載：等它好了再開打
    callout('擂台下載中…', 2.5);
    ensureStage(G.sel.stage).then(() => { if (G.state === 'select') startGame(); });
    return;
  }
  for (const c of Object.values(CH)) c.setActive(false);
  for (const s of G.shots) s.e.destroy();
  G.diff = G.sel.diff; G.focus = null; G.punch = 0; INBUF.t = 0;
  G.shots = []; G.log = []; G.seq = null; G.time = 99; G.timeScale = 1; G.slowmoT = 0; G.hitstop = 0; G.winner = null; G.fogT = 0; G.stormT = 0;
  useStage(G.sel.stage);
  $('dim').style.opacity = 0; $('fog').style.opacity = 0;
  for (const e of Object.values(ENV)) e.env.setTint(0);
  $('banner').classList.remove('on'); $('subtitle').classList.remove('on');
  const mySide = G.sel.side === 0 ? 'tw' : 'jp', aiSide = mySide === 'tw' ? 'jp' : 'tw';
  const myKeys = [...SIDES[mySide].keys]; myKeys.unshift(...myKeys.splice(G.sel.lead, 1));
  const aiKeys = [...SIDES[aiSide].keys]; aiKeys.unshift(...aiKeys.splice(Math.floor(Math.random() * 3), 1));
  G.teams = [{ side: mySide, keys: myKeys }, { side: aiSide, keys: aiKeys }].map((d, t) => ({
    ...d, cur: 0, ai: t === 1 || (t === 0 && G.botP1), members: d.keys.map(k => makeFighter(k, t)) }));
  setupSidelines();
  hudSetup();
  enter(0, 0, -1.4, 1.8); enter(1, 0, 1.4, 1.8);
  G.state = 'intro'; G.introT = 0;
  $('title').hidden = true; $('select').hidden = true; $('hud').hidden = false;
  playMusic('bgm_' + G.stage);
  callout(STAGES[G.stage].name, 1.6);
  showTaunt();
}

// ---------------------------------------------------------------- 召喚陣選角
function renderSelect() {
  const sides = ['tw', 'jp'];
  sides.forEach((sd, i) => {
    const col = $('col' + i);
    col.className = 'col ' + sd + (G.sel.side === i ? ' on' : '');
    col.innerHTML = `<h2>${SIDES[sd].label}</h2><div class="cards">` + SIDES[sd].keys.map((k, j) => {
      const r = ROSTER[k];
      return `<div class="card${G.sel.side === i && G.sel.lead === j ? ' lead' : ''}" data-side="${i}" data-lead="${j}">
        <div class="pic" style="background-image:${picUrl(k)}"></div><b>${r.name}</b><small>特技：${r.spec.name}<br>奧義：${r.ult.name}</small></div>`;
    }).join('') + `</div><small>召喚師：${SIDES[sd].summonerName}</small>`;
  });
  $('stages').innerHTML = Object.entries(STAGES).map(([k, s]) => `<div class="stage${G.sel.stage === k ? ' on' : ''}" data-stage="${k}">${s.name}${ENV[k] ? '' : '<small>（下載中）</small>'}</div>`).join('')
    + '<span class="sep"></span>' + DIFF.map((d, i) => `<div class="stage diff${G.sel.diff === i ? ' on' : ''}" data-diff="${i}">${i + 1}・${d.name}</div>`).join('');
}
function openSelect() {
  G.state = 'select';
  for (const c of Object.values(CH)) c.setActive(false);
  for (const g of crowd) g.c.setActive(false);
  $('title').hidden = true; $('hud').hidden = true; $('select').hidden = false;
  playMusic('bgm_select');
  $('banner').classList.remove('on'); $('subtitle').classList.remove('on');
  renderSelect();
}
$('select').addEventListener('click', e => {
  const card = e.target.closest('.card'), stage = e.target.closest('.stage');
  if (card) { G.sel.side = +card.dataset.side; G.sel.lead = +card.dataset.lead; sfx('menu_click'); renderSelect(); }
  if (stage && stage.dataset.diff != null) { G.sel.diff = +stage.dataset.diff; sfx('menu_click'); renderSelect(); }
  else if (stage) { G.sel.stage = stage.dataset.stage; useStage(G.sel.stage); renderSelect(); }
});

// ---------------------------------------------------------------- 輸入與 AI
const keys = new Set(), pressed = new Set();
addEventListener('pointerdown', () => audioInit());
addEventListener('keydown', e => {
  audioInit();
  if (uiKey(e)) return;
  if (e.code === 'KeyM') { toggleMute(); return; }
  if (['Tab', 'Space', 'F2', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (!keys.has(e.code)) pressed.add(e.code);
  keys.add(e.code);
  if (G.state === 'select') {
    if (e.code === 'KeyH') { showPanel('help'); return; }
    const S = G.sel, stageKeys = Object.keys(STAGES);
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') S.side = 0;
    if (e.code === 'KeyD' || e.code === 'ArrowRight') S.side = 1;
    if (e.code === 'KeyW' || e.code === 'ArrowUp') S.lead = (S.lead + 2) % 3;
    if (e.code === 'KeyS' || e.code === 'ArrowDown') S.lead = (S.lead + 1) % 3;
    if (['Digit1', 'Digit2', 'Digit3'].includes(e.code)) S.diff = +e.code.slice(-1) - 1;
    if (e.code === 'KeyQ' || e.code === 'KeyE') { S.stage = stageKeys[(stageKeys.indexOf(S.stage) + 1) % stageKeys.length]; useStage(S.stage); }
    if (e.code === 'Enter') { sfx('menu_click'); startGame(); return; }
    sfx('menu_click');
    renderSelect();
    return;
  }
  if (e.code === 'KeyH' && G.state === 'title') { showPanel('help'); return; }
  if (e.code === 'Enter' && G.state === 'title') { goSelect(); return; }
  else if (e.code === 'Enter' && G.state === 'end') openSelect();
  if (e.code === 'KeyR' && ['intro', 'fight', 'end'].includes(G.state)) startGame();
  if (e.code === 'Escape' && ['intro', 'fight'].includes(G.state)) { pauseGame(); return; }
  if (e.code === 'Escape' && G.state === 'end') openSelect();
  if (e.code === 'F2') { G.debug = !G.debug; $('debug').hidden = !G.debug; }
  if (e.code === 'KeyT') G.timeScale = G.timeScale < 1 ? 1 : 0.25;
  if (e.code === 'KeyV') toggleFreeCam();
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
// 按鍵配置（2026-10-26 改成格鬥遊戲常見的配置）：左手 A D／方向鍵走、W 跳、S 按住格擋、空白鍵閃避、Q 換將；
// 右手下排 J 爪擊、K 重擊、L 迴旋踢，上排 U 特技、I 奧義、O 護身符。舊鍵 P（奧義）、1（護身符）、Tab（換將）照樣能用。
const ACT_KEYS = [['KeyJ', 'light'], ['KeyK', 'heavy'], ['KeyL', 'kick'], ['KeyU', 'special'], ['KeyI', 'ult'], ['KeyP', 'ult'],
  ['KeyO', 'talisman'], ['Digit1', 'talisman'], ['Space', 'dodge'], ['KeyW', 'jump'], ['ArrowUp', 'jump'], ['KeyQ', 'swap'], ['Tab', 'swap']];
const INBUF = { act: null, t: 0 };   // 按鍵緩衝：上一招還沒收完就按下一招，0.25 秒內一有空檔就自動出招，不會被吃掉
// 每幀一開始就收進緩衝（在打擊停頓 hitstop 的判斷之前）；以前停頓那幾幀按的鍵會被直接丟掉，連招時常常「按了沒反應」
function captureActs() {
  if (G.state !== 'fight') return;
  for (const [k, a] of ACT_KEYS) if (pressed.has(k)) { INBUF.act = a; INBUF.t = 0.25; break; }
}
function humanIntent(dt = 0) {
  const right = keys.has('KeyD') || keys.has('ArrowRight'), left = keys.has('KeyA') || keys.has('ArrowLeft');
  const it = { move: (right ? 1 : 0) - (left ? 1 : 0), block: keys.has('KeyS') || keys.has('ArrowDown'), act: null, human: true };
  if (INBUF.t > 0) it.act = INBUF.act;
  INBUF.t -= dt;
  return it;
}
// ---------------------------------------------------------------- 介面：設定、暫停、說明、觸控按鈕、新手提示
// 設定存在瀏覽器（localStorage）；讀不到（無痕模式等）就用預設值，照樣能玩
const SET_KEY = 'yokai.settings';
const S = Object.assign({ music: 100, sfx: 100, voice: 100, muted: false, touch: 'auto', helpSeen: false, tips: {} },
  (() => { try { return JSON.parse(localStorage.getItem(SET_KEY)) || {}; } catch { return {}; } })());
function saveSettings() { try { localStorage.setItem(SET_KEY, JSON.stringify(S)); } catch { /* 存不了就算了 */ } }
AU.muted = S.muted;
function applyAudio() {
  AU.muted = S.muted;
  if (!AU.ctx) return;
  const now = AU.ctx.currentTime, set = (g, v) => { g.gain.cancelScheduledValues(now); g.gain.setTargetAtTime(v, now, 0.05); };
  set(AU.bus.master, S.muted ? 0 : 1); set(AU.bus.music, musicLevel()); set(AU.bus.sfx, 0.85 * S.sfx / 100); set(AU.bus.voice, S.voice / 100);
}

const PANELS = ['pause', 'settings', 'help'];
const UI = { open: null, back: null, sawTouch: false, endShown: false };
function showPanel(id, back = null) {
  for (const p of PANELS) $(p).hidden = p !== id;
  UI.open = id; UI.back = back;
  if (id === 'settings') renderSettings();
  const first = $(id).querySelector('button:not([hidden]), input');
  if (first) first.focus({ preventScroll: true });
}
function hidePanels() { for (const p of PANELS) $(p).hidden = true; UI.open = null; UI.back = null; }
function closePanel() {
  const back = UI.back;
  hidePanels();
  if (typeof back === 'function') back();
  else if (back) showPanel(back);
}
function pauseGame() {
  if (G.paused || !['intro', 'fight'].includes(G.state)) return;
  G.paused = true; G.pause = true;
  keys.clear(); pressed.clear(); releaseTouch();
  if (AU.ctx && AU.bus.music) AU.bus.music.gain.setTargetAtTime(musicLevel() * 0.4, AU.ctx.currentTime, 0.1);
  showPanel('pause');
}
function resumeGame() {
  hidePanels();
  if (!G.paused) return;
  G.paused = false; G.pause = false;
  keys.clear(); pressed.clear();
  applyAudio();
}
function goSelect() {                                // 標題按「開始」：第一次玩先看操作說明
  if (!S.helpSeen) { S.helpSeen = true; saveSettings(); showPanel('help', () => openSelect()); }
  else openSelect();
}
function toggleFullscreen() {
  const d = document;
  if (d.fullscreenElement) { d.exitFullscreen && d.exitFullscreen(); return; }
  const p = d.documentElement.requestFullscreen && d.documentElement.requestFullscreen({ navigationUI: 'hide' });
  if (p) p.then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {})).catch(() => {});
}
if (!document.fullscreenEnabled) document.querySelectorAll('.fs').forEach(b => { b.hidden = true; });

function renderSettings() {
  for (const k of ['music', 'sfx', 'voice']) { const id = 'vol' + k[0].toUpperCase() + k.slice(1); $(id).value = S[k]; $(id + 'V').textContent = S[k]; }
  $('optMute').textContent = '靜音：' + (S.muted ? '開' : '關');
  $('optTouch').textContent = '觸控按鈕：' + { auto: '自動', on: '顯示', off: '隱藏' }[S.touch];
}
for (const k of ['music', 'sfx', 'voice']) {
  const el = $('vol' + k[0].toUpperCase() + k.slice(1));
  el.addEventListener('input', () => { S[k] = +el.value; $(el.id + 'V').textContent = S[k]; applyAudio(); saveSettings(); });
  el.addEventListener('change', () => { if (k === 'sfx') sfx('hit_light'); });
}

function uiAction(a) {
  switch (a) {
    case 'start': goSelect(); break;
    case 'go': if (G.state === 'select') startGame(); break;
    case 'again': resumeGame(); startGame(); break;
    case 'restart': resumeGame(); startGame(); break;
    case 'select': resumeGame(); openSelect(); break;
    case 'resume': resumeGame(); break;
    case 'pause': pauseGame(); break;
    case 'settings': showPanel('settings', G.paused ? 'pause' : null); break;
    case 'help': showPanel('help', G.paused ? 'pause' : null); break;
    case 'back': closePanel(); break;
    case 'fullscreen': toggleFullscreen(); break;
    case 'share': shareGame(); break;
    case 'mute': toggleMute(); renderSettings(); break;
    case 'touchMode': S.touch = { auto: 'on', on: 'off', off: 'auto' }[S.touch]; saveSettings(); applyTouch(); renderSettings(); break;
    case 'resetTips': S.tips = {}; S.helpSeen = false; saveSettings(); callout('新手提示會重新出現', 1.0); break;
  }
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-ui]');
  if (!b) return;
  audioInit(); sfx('menu_click');
  uiAction(b.dataset.ui);
});
// 面板開著時，鍵盤只操作面板：W/S 或上下鍵移動、Enter 確定、A/D 或左右鍵調音量、Esc 返回
function uiKey(e) {
  if (!UI.open) return false;
  e.preventDefault();
  const box = $(UI.open), el = document.activeElement;
  const items = [...box.querySelectorAll('button, input')].filter(x => !x.hidden && x.offsetParent !== null);
  const i = items.indexOf(el);
  if (e.code === 'Escape') { if (UI.open === 'pause') resumeGame(); else closePanel(); }
  else if (e.code === 'KeyW' || e.code === 'ArrowUp') { if (items.length) items[(i - 1 + items.length) % items.length].focus(); }
  else if (e.code === 'KeyS' || e.code === 'ArrowDown') { if (items.length) items[(i + 1) % items.length].focus(); }
  else if (['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight'].includes(e.code) && el && el.type === 'range') {
    el.value = clamp(+el.value + (/Left|KeyA/.test(e.code) ? -10 : 10), 0, 100);
    el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change'));
  }
  else if ((e.code === 'Enter' || e.code === 'Space') && el && el.tagName === 'BUTTON' && box.contains(el)) el.click();
  else if (e.code === 'KeyM') { toggleMute(); renderSettings(); }
  return true;
}
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });   // 切到別的分頁自動暫停
matchMedia('(orientation: portrait) and (pointer: coarse)').addEventListener('change', e => { if (e.matches) pauseGame(); });   // 手機轉直向（會蓋上「請轉橫」畫面）也暫停

// 觸控按鈕：按下＝按住對應的鍵，放開＝放掉（和鍵盤走同一套輸入）
const touchBtns = [...document.querySelectorAll('#touch [data-key]')];
const TB = { ult: $('tbUlt'), tal: $('tbTal'), spec: $('tbSpec'), swap: $('tbSwap') };
function applyTouch() {
  const coarse = matchMedia('(pointer: coarse)').matches;
  document.body.classList.toggle('touch', S.touch === 'on' || (S.touch === 'auto' && (coarse || UI.sawTouch)));
}
function releaseTouch() { for (const b of touchBtns) { keys.delete(b.dataset.key); b.classList.remove('down'); } }
for (const b of touchBtns) {
  const code = b.dataset.key;
  const up = () => { keys.delete(code); b.classList.remove('down'); };
  b.addEventListener('pointerdown', e => {
    e.preventDefault(); audioInit();
    try { b.setPointerCapture(e.pointerId); } catch { /* 合成事件沒有真的指標，略過 */ }
    if (!keys.has(code)) pressed.add(code);
    keys.add(code); b.classList.add('down');
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, up);
  b.addEventListener('contextmenu', e => e.preventDefault());
}
addEventListener('pointerdown', e => { if (e.pointerType === 'touch' && !UI.sawTouch) { UI.sawTouch = true; applyTouch(); } }, true);
applyTouch();
// 手機關掉自動旋轉時：點按鈕進全螢幕並鎖成橫向（Android Chrome 支援；iPhone 只能請玩家自己轉）
$('rotateBtn').addEventListener('click', () => {
  const d = document.documentElement, p = d.requestFullscreen && d.requestFullscreen({ navigationUI: 'hide' });
  const lock = () => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {});
  if (p) p.then(lock).catch(lock); else lock();
});
// 遊戲手把（Xbox／PS／Switch Pro 等標準配置）：把手把按鈕換成鍵盤按鍵，跟鍵盤走同一套輸入
//   對戰：X 爪擊、Y 重擊、B 迴旋踢、A 閃避、上 跳、下 格擋、LB 特技、RB 奧義、LT 護身符、RT 換將、Start 暫停
//   選單：方向選擇、A 確定、B 返回、X 再拚一場、LB／RB 換擂台
const PAD = { prev: {} };
function padStep() {
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  const p = pads[0], want = {};
  if (p) {
    const b = i => !!(p.buttons[i] && p.buttons[i].pressed), ax = p.axes[0] || 0, ay = p.axes[1] || 0;
    want.ArrowLeft = b(14) || ax < -0.5; want.ArrowRight = b(15) || ax > 0.5;
    want.ArrowUp = b(12) || ay < -0.6; want.ArrowDown = b(13) || ay > 0.6;
    if (UI.open || ['title', 'select', 'end'].includes(G.state)) { want.Enter = b(0); want.Escape = b(1); want.KeyR = b(2); want.KeyQ = b(4); want.KeyE = b(5); }
    else { want.KeyJ = b(2); want.KeyK = b(3); want.KeyL = b(1); want.Space = b(0); want.KeyU = b(4); want.KeyI = b(5); want.KeyO = b(6); want.KeyQ = b(7); }
    want.Escape = want.Escape || b(9);
  }
  for (const code of new Set([...Object.keys(want), ...Object.keys(PAD.prev)])) {
    const now = !!want[code], was = !!PAD.prev[code];
    if (now !== was) window.dispatchEvent(new KeyboardEvent(now ? 'keydown' : 'keyup', { code }));
  }
  PAD.prev = want;
}
function pollPad() { padStep(); requestAnimationFrame(pollPad); }
addEventListener('gamepadconnected', () => callout('手把已連接', 1.2));
requestAnimationFrame(pollPad);
window.__padStep = padStep;                         // 測試鉤：讀一次手把（背景分頁不跑 requestAnimationFrame 時用）

// 分享：手機跳出系統分享選單（可以選 FB、LINE…）；電腦就把網址複製起來
const SHARE_URL = 'https://chetbakert-droid.github.io/yokai-arena/';
async function shareGame() {
  const data = { title: '妖怪拚台', text: '台灣妖怪 vs 日本式神！虎姑婆、魔神仔、林投姐對上九尾狐、天狗、雪女，打開網頁就能玩的 3 對 3 格鬥遊戲。', url: SHARE_URL };
  if (navigator.share && TOUCH_DEVICE) { try { await navigator.share(data); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(SHARE_URL); callout('網址已複製，可以貼到 FB', 1.6); }
  catch { callout(SHARE_URL, 3); }
}

function touchHud() {                                 // 奧義集滿時發光；特技、護身符、換將冷卻中變暗
  if (!document.body.classList.contains('touch')) return;
  const f = active(0);
  TB.ult.classList.toggle('ready', f.meter >= 100);
  TB.tal.style.setProperty('--cd', clamp(f.cd.tal / 15, 0, 1));
  TB.spec.style.setProperty('--cd', clamp(f.cd.spec / 2.4, 0, 1));
  TB.swap.style.setProperty('--cd', clamp(f.cd.swap / 3, 0, 1));
}

// 新手提示：每種提示只出現一次（記在設定裡），同一時間只顯示一則
let tipTimer = 0;
function tip(id, kb, touch, t = 4.5) {
  if (S.tips[id] || tipTimer > 0) return;
  S.tips[id] = 1; saveSettings();
  const e = $('tip'); e.innerHTML = document.body.classList.contains('touch') ? touch : kb; e.classList.add('on'); tipTimer = t;
}
function checkTips() {
  if (G.state !== 'fight' || G.teams[0].ai) return;
  const f = active(0), team = G.teams[0], tal = SIDES[team.side].tal;
  if (G.time < 97) tip('move', '<kbd>A</kbd><kbd>D</kbd> 移動、<kbd>W</kbd> 跳，<kbd>J</kbd> 爪擊、<kbd>K</kbd> 重擊、<kbd>L</kbd> 迴旋踢，按住 <kbd>S</kbd> 格擋',
    '左邊按鈕：移動、格擋。右邊按鈕：出招');
  if (f.meter >= 100) tip('ult', '靈力滿了！按 <kbd>I</kbd> 放奧義', '靈力滿了！按發光的「奧義」放大招');
  if (f.st === 'block' && f.guard < 35) tip('guard', '護盾快破了！一直格擋會「破防」，暈 1.2 秒', '護盾快破了！一直格擋會「破防」，暈 1.2 秒');
  if (f.hp < 35 && f.cd.tal <= 0) tip('tal', `危險！按 <kbd>O</kbd> 用${tal}，2 秒內不會受傷`, `危險！按「符」用${tal}，2 秒內不會受傷`);
  if (f.hp < 55 && team.members.some((m, i) => i !== team.cur && !m.dead)) tip('swap', '打不過？按 <kbd>Q</kbd> 換下一隻隊友上場', '打不過？按「換」換下一隻隊友上場');
}
function uiStep(dt) {                                 // 每幀：同步畫面狀態給 CSS、勝負選單、提示計時
  if (document.body.dataset.state !== G.state) document.body.dataset.state = G.state;
  const wantEnd = G.state === 'end' && G.endT > 1.2;
  if (wantEnd !== UI.endShown) { UI.endShown = wantEnd; $('endMenu').hidden = !wantEnd; }
  if (tipTimer > 0 && (tipTimer -= dt) <= 0) $('tip').classList.remove('on');
}

const RANGED = { foxfire: [1.9, 9], gust: [1.6, 9], chicken: [1.9, 9], debt: [1.8, 9], frost: [0.9, 2.6] };
function aiIntent(f, dt) {
  const o = opp(f), d = Math.abs(o.x - f.x), toward = Math.sign(o.x - f.x) || f.facing;
  const ai = f.ai || (f.ai = { t: 0.4, move: 0, block: 0 });
  const it = { move: 0, block: false, act: null };
  const D = DIFF[G.diff ?? 1];
  ai.t -= dt; ai.block -= dt;
  if (ai.block > 0) { it.block = true; return it; }
  if ((o.st === 'attack' || o.st === 'special') && d < 1.6 && Math.random() < dt * D.block) { ai.block = 0.45; it.block = true; return it; }
  if (['getup', 'stun', 'frozen', 'hit'].includes(o.st) && d < 1.1 && Math.random() < D.punish * dt * 4) { it.act = Math.random() < 0.5 ? 'heavy' : 'light'; return it; }
  if (ai.t > 0) { it.move = ai.move; return it; }
  ai.t = (0.16 + Math.random() * 0.22) * D.think; ai.move = 0;
  if (f.meter >= 100 && Math.random() < D.ult) { it.act = 'ult'; return it; }
  if (f.hp < 30 && f.cd.tal <= 0 && Math.random() < 0.15) { it.act = 'talisman'; return it; }
  const team = G.teams[f.team];
  if (f.hp < 25 && f.cd.swap <= 0 && team.members.some((m, i) => i !== team.cur && !m.dead && m.hp > 50) && Math.random() < 0.08) { it.act = 'swap'; return it; }
  const rg = RANGED[f.def.spec.kind];
  if (rg && d > rg[0] && d < rg[1] && f.cd.spec <= 0 && Math.random() < 0.5) { it.act = 'special'; return it; }
  if (d > 1.05) { ai.move = toward; it.move = toward; return it; }
  if (d < 0.5) { ai.move = -toward; it.move = -toward; return it; }
  const r = Math.random();
  it.act = r < 0.42 ? 'light' : r < 0.66 ? 'heavy' : r < 0.88 ? 'kick' : (f.cd.spec <= 0 ? 'special' : 'light');
  ai.t = (0.3 + Math.random() * 0.45) * D.think;
  return it;
}

// ---------------------------------------------------------------- 鏡頭
let orbit = null;
const camPos = new pc.Vec3(0, 1.5, 4.0), camLook = new pc.Vec3(0, 1.0, LANE_Z - 0.8);
function toggleFreeCam() {
  G.freeCam = !G.freeCam;
  if (G.freeCam) {
    orbit = new OrbitControls({ distance: 5, pitch: 10, target: { x: camLook.x, y: 1, z: LANE_Z } });
    orbit.attach({ canvas, cameraEntity: cam }); orbit.yaw = 0;
  } else if (orbit) { orbit.detach(); orbit = null; }
}
function updateCamera(dt) {
  if (G.freeCam) { orbit.update(); return; }
  if (!G.teams.length || G.state === 'select' || G.state === 'title') {        // 選角／標題：慢慢橫移看擂台
    const t = performance.now() / 1000;
    cam.setPosition(Math.sin(t * 0.15) * 1.2, 1.5, 3.8); cam.lookAt(Math.sin(t * 0.15) * 0.6, 1.2, -2.5);
    return;
  }
  const a = active(0), b = active(1);
  const mid = (a.x + b.x) / 2, sep = Math.abs(a.x - b.x);
  const k = Math.min(1, dt * 4), g = laneY(mid);
  let cx = clamp(mid * 0.7, -1.2, 1.2), cz = 4.0 + clamp(sep - 2, 0, 3) * 0.45, lx = clamp(mid * 0.85, -1.4, 1.4);
  if (G.focus && G.focus.t > 0) {                        // 奧義／KO：鏡頭推近目標
    G.focus.t -= dt;
    const w = Math.min(1, G.focus.t * 3);
    cx = lerp(cx, clamp(G.focus.x, -1.6, 1.6), 0.7 * w); lx = lerp(lx, G.focus.x, 0.8 * w); cz -= G.focus.amt * w;
  }
  cz -= G.punch * 0.8; G.punch = Math.max(0, G.punch - dt * 2.5);   // 重擊：鏡頭往前推一下
  camPos.set(lerp(camPos.x, cx, k), 1.5 + g, lerp(camPos.z, cz, Math.min(1, dt * 7)));
  camLook.set(lerp(camLook.x, lx, k), 1.0 + g, LANE_Z - 0.8);
  const sh = G.shake > 0 ? G.shake * 0.12 : 0;
  cam.setPosition(camPos.x + (Math.random() - 0.5) * sh, camPos.y + (Math.random() - 0.5) * sh, camPos.z);
  cam.lookAt(camLook);
  G.shake = Math.max(0, G.shake - dt);
}

// ---------------------------------------------------------------- 主迴圈
const slowMul = f => (f.slowT > 0 && !['frozen', 'stun', 'ko', 'enter'].includes(f.st) ? 0.55 : 1);   // 冰息減速；冰封／暈眩照真實時間算
function step(rawDt) {
  if (G.pause) { pressed.clear(); return; }          // 截圖用：整個世界（含特效）凍結
  const dt0 = Math.min(rawDt, 0.05);
  if (G.slowmoT > 0 && (G.slowmoT -= dt0) <= 0) G.timeScale = 1;
  captureActs();
  overlays(dt0);
  updateFx(dt0);
  updateCamera(dt0);
  uiStep(dt0);
  if (['loading', 'title', 'select'].includes(G.state)) { pressed.clear(); return; }
  if (G.hitstop > 0) { G.hitstop -= dt0; for (const t of [0, 1]) active(t).c.playbackSpeed = 0; hud(); pressed.clear(); return; }
  const dt = dt0 * G.timeScale;

  if (G.state === 'intro') {
    G.introT += dt;
    if (G.introT > 3.2) { G.state = 'fight'; callout('開打！', 0.9); sfx('round_start'); }
  } else if (G.state === 'fight') {
    G.time -= dt;
    if (G.time <= 0) timeUp();
    for (const t of [0, 1]) {
      const f = active(t), dtF = dt * slowMul(f);
      const it = G.teams[t].ai ? aiIntent(f, dtF) : humanIntent(dtF);
      control(f, it, dtF);
    }
  } else if (G.state === 'end') G.endT += dt;

  if (G.seq) runSeq(dt);
  for (const t of [0, 1]) {
    const f = active(t);
    f.slowT = Math.max(0, f.slowT - dt); f.debt = Math.max(0, f.debt - dt); f.reversed = Math.max(0, f.reversed - dt);
    updateFighter(f, dt * slowMul(f));
  }
  const a = active(0), b = active(1);
  const passing = ['dodge', 'jump', 'knock', 'ko', 'ult'];
  if (!passing.includes(a.st) && !passing.includes(b.st)) {   // 兩人不能重疊
    const minSep = a.hw + b.hw + 0.12, d = b.x - a.x, ax = arenaX();
    if (Math.abs(d) < minSep) {
      const push = (minSep - Math.abs(d)) / 2, s = Math.sign(d) || 1;
      a.x = clamp(a.x - s * push, -ax, ax); b.x = clamp(b.x + s * push, -ax, ax);
    }
  }
  for (const t of [0, 1]) syncTransform(active(t));
  updateSidelines(dt);
  updateShots(dt);
  if (G.state === 'fight') checkKO();
  hud();
  checkTips();
  pressed.clear();
}
app.on('update', step);

// ---------------------------------------------------------------- 測試鉤
window.__dbg = () => ({ state: G.state, stage: G.stage, time: +G.time.toFixed(2), seq: G.seq && G.seq.kind, shots: G.shots.length,
  teams: G.teams.map(t => ({ side: t.side, cur: t.cur, members: t.members.map(m => ({ key: m.key, st: m.st, hp: +m.hp.toFixed(1), x: +m.x.toFixed(2), y: +m.y.toFixed(2), meter: +m.meter.toFixed(0), guard: +m.guard.toFixed(0), dead: m.dead, file: m.file, debt: +m.debt.toFixed(1), slow: +m.slowT.toFixed(1) })) })) });
window.__tick = (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) step(dt); return window.__dbg(); };
window.__press = code => { pressed.add(code); return code; };
window.__hold = (code, on = true) => { on ? keys.add(code) : keys.delete(code); return code; };
window.__bot = (on = true) => { G.botP1 = on; if (G.teams[0]) G.teams[0].ai = on; return on; };
window.__start = (opts = {}) => { hidePanels(); G.paused = false; G.pause = false; Object.assign(G.sel, opts); startGame(); return window.__dbg(); };
window.__set = fn => { fn(G, active); return window.__dbg(); };
window.__swap = t => { G.teams[t].members[G.teams[t].cur].cd.swap = 0; trySwap(t); return window.__dbg(); };
window.__ult = t => { const f = active(t); f.meter = 100; if (free(f)) startUlt(f); return window.__dbg(); };
window.__showcase = (kind = 'enter', frac = 0.5) => {
  for (const c of Object.values(CH)) c.setActive(false);
  for (const g of crowd) g.c.setActive(false);
  Object.keys(ROSTER).forEach((k, i) => {
    // 虎姑婆的奧義是變身後的老虎在演，所以奧義展示改用老虎模型
    const r = ROSTER[k], c = CH[kind === 'ult' && r.alt ? r.alt : r.file], o = { c, clip: null, loop: false };
    c.setActive(true); c.setReveal(1); c.setTint(0); c.setScale(r.scale, r.scale, r.scale);
    const x = -2.6 + i * 1.04;
    c.setPosition(x, laneY(x), LANE_Z); c.setRotation(0, -90, 0);
    setPose(o, kind + '_' + k, frac);
  });
  G.pause = true; G.state = 'showcase';
  cam.setPosition(0, 1.5, 6.8); cam.lookAt(0, 0.95, -1.5);
  return kind + ' @ ' + frac;
};
window.__bones = (t, names) => { const f = active(t); return { st: f.st, x: +f.x.toFixed(2), y: +(laneY(f.x) + f.y).toFixed(2), hw: f.hw, h: f.h, t: +f.c.animationTime.toFixed(1), pts: (bonePositions(f, names, f.c.animationTime) || []).map(p => p.map(v => +v.toFixed(2))) }; };
window.__meta = () => ({ DUR, files: MAIN_FILES, crowd: crowd.length, ground: Object.fromEntries(Object.entries(ENV).map(([k, e]) => [k, { mpu: +e.mpu.toFixed(3), lane: e.lane.filter((_, i) => i % 4 === 0).map(([x, y]) => [x, +y.toFixed(2)]) }])) });
window.G = G;
window.AU = AU;
window.__audio = () => ({ ctx: AU.ctx && AU.ctx.state, ready: AU.ready, loaded: Object.keys(AU.buf).length, music: AU.musicKey, muted: AU.muted });

useStage('temple');
G.state = 'title';
$('loading').hidden = true;
$('startHint').hidden = false;
$('titleMenu').hidden = false;
BOOTED = true;
onStageLoaded = () => { if (G.state === 'select') renderSelect(); };   // 召喚陣上的「下載中」字樣拿掉
for (const k of Object.keys(STAGES)) ensureStage(k);              // 其他擂台在背景下載
updateCamera(0);
