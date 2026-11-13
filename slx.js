/* =====================================================================
 * SALTLINE EXTENSION MODULE (SLX) v1.0
 * ---------------------------------------------------------------------
 * 以原版 Saltline（Felix Rieseberg / Claude Fable 5.2）为底座的追加扩展。
 * 本模块作为独立 <script> 追加在主脚本之后，原游戏脚本零改动。
 * 全部挂点均使用原项目的官方出口：
 *   - window.__G        游戏上下文（boot 中 window.__G = t）
 *   - window.__ready    装载完成标志
 *   - t.render.{scene,sun,sky,exposure}   渲染实例公开字段
 *   - t.hud.message(msg)                  原版提示条
 *   - t.events.on/emit                    原版事件总线
 * 功能与按键：
 *   Digit1 / Digit2 / Digit3 —— 三套枪械配置切换（标准 / SD 消音 / DMR 精准）
 *   KeyT                     —— 昼 / 夜 / 黄昏时间主题循环
 *   KeyO                     —— 准星颜色循环
 *   KeyN                     —— 准星中心点开关
 *   设置持久化到 localStorage("saltline.ext.v1")，不触碰原版设置键。
 * ===================================================================== */
(function () {
  'use strict';
  if (window.__SLX__) return;
  window.__SLX__ = true;

  const SKEY = 'saltline.ext.v1';
  const store = (() => {
    try { return Object.assign({ theme: 0, loadout: 0, xcolor: 0, xdot: true }, JSON.parse(localStorage.getItem(SKEY)) || {}); }
    catch { return { theme: 0, loadout: 0, xcolor: 0, xdot: true }; }
  })();
  const save = () => { try { localStorage.setItem(SKEY, JSON.stringify(store)); } catch { } };
  const log = (...a) => console.log('[slx]', ...a);

  /* 等待原版装载完成：__G 是官方游戏上下文，__ready 是官方装载标志 */
  function boot() {
    const G = window.__G;
    if (!window.__ready || !G || !G.weapon || !G.weapon.root || !G.render || !G.render.sky || !G.hud) {
      setTimeout(boot, 250);
      return;
    }
    try { init(G); log('ready'); }
    catch (e) { console.error('[slx] init failed', e); }
  }

  function init(G) {
    const viewLayer = 1; /* 原渲染模块的视图模型层（layer zc = 1） */

    /* 从原项目实例反查构造器：不引用打包内名，升级打包仍可用 */
    let MeshC = null, MatC = null, ColorC = null, BoxGeoC = null;
    G.weapon.root.traverse(o => { if (!MeshC && o.isMesh) MeshC = o.constructor; });
    G.weapon.root.traverse(o => {
      if (!MatC && o.isMesh && o.material && o.material.isMeshStandardMaterial) MatC = o.material.constructor;
    });
    /* ColorC 在下方从材质实例取 */
    G.render.scene.traverse(o => {
      if (!BoxGeoC && o.isMesh && o.geometry && o.geometry.type === 'BoxGeometry') BoxGeoC = o.geometry.constructor;
    });

    let sampleMat = null;
    G.weapon.root.traverse(o => { if (!sampleMat && o.isMesh && o.material && o.material.color) sampleMat = o.material; });
    if (!sampleMat) return log('no material sample');
    ColorC = sampleMat.color.constructor;

    const toast = (msg) => { try { G.hud.message(String(msg)); } catch { } };

    /* ================= 1) 枪械配置（挂点数据化，三套配置共用一把 PAC-9 实例） ================= */
    const LOADOUTS = [
      { id: 'std', name: G.weapon.name, mag: G.weapon.magSize, reserve: G.weapon.reserve, spread: 1, dmgMul: 1, paint: null, kit: [] },
      { id: 'sd',  name: 'PAC-9 SD 消音型',    mag: 45, reserve: 150, spread: 0.72, dmgMul: 0.85, paint: 0x39424a, kit: ['suppressor'] },
      { id: 'dmr', name: 'PAC-9 DMR 精准型',   mag: 15, reserve: 60,  spread: 0.45, dmgMul: 1.6,  paint: 0x6d5a3e, kit: ['scope'] },
    ];
    const saved = LOADOUTS.map(() => ({ ammo: null, reserve: null }));

    /* 原始材质色（切换涂装时恢复） */
    const mat0 = new Map();
    G.weapon.root.traverse(o => {
      if (o.isMesh && o.material && o.material.color) mat0.set(o.material, o.material.color.clone());
    });

    /* 配件网格：BoxGeometry 由关卡实例反查（与原作积木式美术一致），
       找不到 BoxGeometry 时回退为克隆枪身上最小网格的几何体并整体缩放成型；
       挂到视图模型层（layer 1），坐标取自原版武器规格 mi（muzzle=[0,0,-.531]，railTop≈.0435） */
    let small = null, smallV = Infinity;
    G.weapon.root.traverse(o => {
      if (!o.isMesh || !o.geometry) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox;
      const v = (b.max.x - b.min.x) * (b.max.y - b.min.y) * (b.max.z - b.min.z);
      if (v > 0 && v < smallV) { smallV = v; small = o; }
    });
    const kitMeshes = {};
    if (MeshC && MatC && (BoxGeoC || small)) {
      const mk = (w, h, d, x, y, z, mat) => {
        const geo = BoxGeoC ? new BoxGeoC(w, h, d) : small.geometry.clone();
        const m = new MeshC(geo, mat);
        m.position.set(x, y, z);
        if (!BoxGeoC) m.scale.set(w * 30, h * 30, d * 30); /* 回退：以缩放近似目标尺寸 */
        m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false;
        m.layers.set(viewLayer);
        return m;
      };
      const dark = new MatC({ color: 0x23282d, roughness: 0.55, metalness: 0.5 });
      const dark2 = new MatC({ color: 0x2a2f34, roughness: 0.5, metalness: 0.4 });
      kitMeshes.suppressor = mk(0.034, 0.034, 0.12, 0, 0, -0.585, dark);
      kitMeshes.scope = mk(0.030, 0.030, 0.090, 0, 0.095, -0.100, dark2);
      G.weapon.root.add(kitMeshes.suppressor, kitMeshes.scope);
      kitMeshes.suppressor.visible = false;
      kitMeshes.scope.visible = false;
    } else {
      log('kit unavailable: constructors missing');
    }

    function applyLoadout(idx) {
      const ve = G.weapon, c = LOADOUTS[idx], s = saved[idx];
      ve.name = c.name;
      ve.magSize = c.mag;
      ve.reserve = s.reserve != null ? s.reserve : c.reserve;
      ve.ammo = s.ammo != null ? Math.max(0, Math.min(s.ammo, c.mag)) : c.mag;
      for (const [mat, orig] of mat0) {
        if (c.paint) {
          mat.color.copy(orig).lerp(new ColorC(c.paint), 0.55);
        } else {
          mat.color.copy(orig);
        }
      }
      for (const k in kitMeshes) kitMeshes[k].visible = c.kit.includes(k);
    }

    let cur = Math.max(0, Math.min(LOADOUTS.length - 1, store.loadout | 0));
    let switching = 0, shown = true;

    function select(idx) {
      if (switching || idx === cur || idx < 0 || idx >= LOADOUTS.length) return;
      switching = 1;
      saved[cur].ammo = G.weapon.ammo;
      saved[cur].reserve = G.weapon.reserve;
      api.setVisible(false); /* 直接操作原实例：绕过包装器，避免污染 shown 标志 */
      setTimeout(() => {
        cur = idx;
        applyLoadout(cur);
        api.setVisible(shown);
        switching = 0;
        toast(LOADOUTS[cur].name);
        store.loadout = cur; save();
      }, 340);
    }

    /* 武器控制器：主循环/HUD/战斗读取 t.weapon —— 透传到原版武器实例，
       并在每帧按配置收敛散布（原版 ve.spread 由武器内部每帧重写） */
    const api = G.weapon;
    const ctrl = {
      update(dt) {
        api.update(dt);
        const c = LOADOUTS[cur];
        if (c.spread !== 1 && isFinite(api.spread)) api.spread *= c.spread;
      },
      setVisible(v) { shown = !!v; if (!switching) api.setVisible(shown); },
      setWetness(w) { if (api.setWetness) api.setWetness(w); },
      muzzleWorld(v) { return api.muzzleWorld ? api.muzzleWorld(v) : v; },
      snap() { return api.snap ? api.snap() : undefined; },
      reload() { return api.reload ? api.reload() : undefined; },
      reset() {
        for (const s of saved) { s.ammo = null; s.reserve = null; }
        if (api.reset) api.reset();
        applyLoadout(cur);
      },
    };
    for (const k of ['ammo', 'magSize', 'reserve', 'name', 'spread', 'state', 'ads', 'root', 'info', 'debug', 'damage', 'rpm']) {
      Object.defineProperty(ctrl, k, {
        get() { return api[k]; },
        set(v) { api[k] = v; },
        configurable: true,
      });
    }
    G.weapon = ctrl;
    applyLoadout(cur);

    /* ================= 1b) 武器伤害系数（包装原版 combat.playerShot） =================
       武器每发读取 i.combat.playerShot（i 为活引用），运行时替换即可按配置缩放伤害，
       无需改动原码。命中信息（点/部位/击杀）同时驱动伤害飘字。 */
    const dmgLayer = document.createElement('div');
    dmgLayer.id = 'slx-dmg';
    dmgLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:5';
    document.getElementById('ui').appendChild(dmgLayer);
    function showDamage(point, amount, weak, killed) {
      try {
        const v = point.clone().project(G.camera);
        if (v.z > 1) return;
        if (dmgLayer.children.length > 24) dmgLayer.firstChild.remove();
        const el = document.createElement('div');
        el.textContent = String(amount);
        el.style.cssText = 'position:absolute;left:' + (((v.x * 0.5 + 0.5) * innerWidth) | 0) + 'px;top:'
          + (((-v.y * 0.5 + 0.5) * innerHeight) | 0) + 'px;transform:translate(-50%,-50%);'
          + 'font:700 ' + (killed ? '17' : '15') + 'px/1 var(--f-mono);color:'
          + (killed ? 'var(--alarm)' : weak ? 'var(--signal)' : 'var(--bone)')
          + ';text-shadow:0 0 3px rgba(0,0,0,.8);transition:transform .7s ease-out,opacity .7s ease-out;pointer-events:none;';
        dmgLayer.appendChild(el);
        requestAnimationFrame(() => { el.style.transform = 'translate(-50%,-150%)'; el.style.opacity = '0'; });
        setTimeout(() => el.remove(), 750);
      } catch { }
    }
    if (G.combat && G.combat.playerShot) {
      const origShot = G.combat.playerShot.bind(G.combat);
      const wrappedShot = (eye, dir, opt) => {
        const mul = LOADOUTS[cur].dmgMul || 1;
        let o = opt;
        if (mul !== 1 && o && o.damage != null) o = Object.assign({}, o, { damage: o.damage * mul });
        const r = origShot(eye, dir, o);
        if (r && r.surface === 'enemy' && r.point) {
          const base = (o && o.damage != null) ? o.damage : 26;
          showDamage(r.point, Math.round(base * (r.part === 'weak' ? 2.2 : 1)), r.part === 'weak', r.killed);
        }
        return r;
      };
      wrappedShot.__slx = 1;
      G.combat.playerShot = wrappedShot;
    }

    /* ================= 1c) 击杀信息流（右侧滚动列表，复用原版 HUD 视觉变量） ================= */
    const feed = document.createElement('div');
    feed.style.cssText = 'position:absolute;top:calc(16px + var(--sat,0px));right:14px;display:flex;flex-direction:column;gap:4px;align-items:flex-end;pointer-events:none;z-index:6';
    document.getElementById('ui').appendChild(feed);
    function feedAdd(text) {
      const el = document.createElement('div');
      el.textContent = text;
      el.style.cssText = 'font:500 11px/1 var(--f-mono);letter-spacing:.04em;color:var(--bone);'
        + 'background:var(--plate-solid);border:1px solid var(--line);padding:5px 8px;opacity:0;transition:opacity .2s';
      feed.appendChild(el);
      requestAnimationFrame(() => { el.style.opacity = '1'; });
      while (feed.children.length > 5) feed.firstChild.remove();
      setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 260); }, 3800);
    }

    /* ================= 2) 时间主题（天空/太阳/曝光，运行时切换） ================= */
    const skyMat = G.render.sky.material;
    const sun = G.render.sun;
    let base = null;
    function captureBase() {
      if (base) return;
      const u = skyMat.uniforms;
      const a3 = (c) => [c.r, c.g, c.b];
      base = {
        uEnv: u.uEnv.value,
        zen: a3(u.uZen.value), hor: a3(u.uHor.value), horAway: a3(u.uHorAway.value),
        sun: a3(u.uSunCol.value),
        sunInt: sun.intensity, exp: G.render.exposure,
        label: '黄昏 · 港区雨幕',
      };
    }
    const THEMES = [
      null, /* 黄昏 = 原版基准（启动时捕获） */
      { label: '晴天清晨', uEnv: 0.10, zen: [0.28, 0.50, 0.78], hor: [0.82, 0.87, 0.92], horAway: [0.58, 0.66, 0.76], sun: [1.0, 0.96, 0.86], sunInt: 11.5, exp: 1.06 },
      { label: '断电风暴', uEnv: 0.82, zen: [0.008, 0.012, 0.022], hor: [0.045, 0.06, 0.09], horAway: [0.02, 0.03, 0.05], sun: [0.42, 0.52, 0.72], sunInt: 2.2, exp: 0.82 },
    ];
    let themeIdx = Math.max(0, Math.min(THEMES.length - 1, store.theme | 0));
    function applyTheme(idx, silent) {
      captureBase();
      const u = skyMat.uniforms;
      const t = idx === 0 ? base : THEMES[idx];
      const v3 = (u2, v) => u2.value.set(v[0], v[1], v[2]);
      v3(u.uZen, t.zen); v3(u.uHor, t.hor); v3(u.uHorAway, t.horAway); v3(u.uSunCol, t.sun);
      u.uEnv.value = t.uEnv;
      sun.color.setRGB(t.sun[0], t.sun[1], t.sun[2]);
      sun.intensity = t.sunInt;
      G.render.exposure = t.exp;
      themeIdx = idx;
      store.theme = idx; save();
      if (!silent) toast('主题：' + t.label);
    }

    /* ================= 3) 准星自定义（原版 .h-cross DOM，注入一条覆盖规则） ================= */
    const XCOLORS = ['#e8e4da', '#7fd4ff', '#ffd27f', '#8dff9e', '#ff9ecf'];
    function applyXhair() {
      let st = document.getElementById('slx-style');
      if (!st) { st = document.createElement('style'); st.id = 'slx-style'; document.head.appendChild(st); }
      st.textContent = `.h-cross i{background:${XCOLORS[store.xcolor | 0]}!important}`
        + (store.xdot ? '' : '.h-cross .c-dot{display:none!important}');
    }

    /* ================= 3b) 地图布局加载（移植自 TIDEBREAK 地图维度） =================
       原版 boot 以 URL ?seed= 播种关卡随机数（rng:il(+(i.seed||4207))），
       切换布局 = 换 seed 并重载；不同 seed 生成不同的集装箱堆叠布局。 */
    const LAYOUTS = [
      { seed: 4207,  label: '港区 · 标准布局' },
      { seed: 31337, label: '港区 · 变体 α' },
      { seed: 90210, label: '港区 · 变体 β' },
    ];
    let layoutIdx = Math.max(0, Math.min(LAYOUTS.length - 1, store.layout | 0));
    function applyLayout(idx, silent) {
      layoutIdx = idx;
      store.layout = idx; save();
      const u = new URLSearchParams(location.search);
      u.set('seed', String(LAYOUTS[idx].seed));
      if (!silent) toast('布局已切换：' + LAYOUTS[idx].label + '（重开后生效）');
      setTimeout(() => { location.search = u.toString(); }, silent ? 0 : 700);
    }
    /* 启动时若记忆布局与当前 URL 不符且 URL 未显式带 seed，则静默应用一次（无循环：
       应用后 URL 携带 seed，后续刷新直接命中） */
    if (layoutIdx > 0 && !new URLSearchParams(location.search).has('seed')) {
      applyLayout(layoutIdx, true);
    }

    /* ================= 3c) 手雷投掷（移植自 TIDEBREAK 攻击机制） =================
       G 键抛掷：弹道积分 + 原版 physics.raycast 碰撞 → fx.explosion 视听 + 范围伤害
       （遍历 t.enemies.list 调 enemy.damage，击杀走原版事件流）。每次出击 3 枚，
       支持多枚并发（各自独立弹道与引信，同 TIDEBREAK 行为）。 */
    let nades = 3;
    const grenades = [];
    const GRENADE = { speed: 13, up: 3.5, gravity: 20, radius: 7, maxDmg: 110, fuse: 2.2 };
    function grenadeExplode(g) {
      const idx = grenades.indexOf(g);
      if (idx < 0) return;
      grenades.splice(idx, 1);
      try {
        const pos = g.mesh.position.clone();
        G.render.scene.remove(g.mesh);
        g.mesh.geometry.dispose(); g.mesh.material.dispose(); g.mesh = null;
        G.fx.explosion(pos, 1.6);
        let killed = 0;
        const list = (G.enemies && G.enemies.list) || [];
        for (const e of list) {
          if (!e.alive || !e.pos) continue;
          const dx = e.pos.x - pos.x, dy = (e.pos.y + 0.9) - pos.y, dz = e.pos.z - pos.z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d < GRENADE.radius) {
            const dmg = Math.round(GRENADE.maxDmg * (1 - d / GRENADE.radius));
            if (e.damage(dmg, e.pos, null) === true) killed++;
          }
        }
        if (killed > 0) feedAdd('手雷击杀 ×' + killed);
        if (G.player && G.player.addShake) G.player.addShake(0.6);
      } catch (e) { console.error('[slx] grenade explode', e); }
    }
    function grenadeStep() {
      const dt = Math.min(0.033, (G.time && G.time.dt) || 0.016);
      for (const g of grenades.slice()) {
        g.fuse -= dt;
        g.vel.y -= GRENADE.gravity * dt;
        const prev = g.mesh.position.clone();
        g.mesh.position.addScaledVector(g.vel, dt);
        const seg = g.mesh.position.clone().sub(prev);
        const dist = seg.length();
        if (dist > 0.001) {
          const hit = G.physics.raycast(prev, seg.clone().normalize(), dist);
          if (hit) { g.mesh.position.copy(prev).addScaledVector(seg.clone().normalize(), Math.max(0, hit.dist - 0.05)); grenadeExplode(g); continue; }
        }
        if (g.mesh.position.y < 0.06 && g.vel.y < 0) {
          g.mesh.position.y = 0.06;
          g.vel.y = -g.vel.y * 0.35;
          g.vel.x *= 0.7; g.vel.z *= 0.7;
          if (g.vel.length() < 1.5) { grenadeExplode(g); continue; }
        }
        if (g.fuse <= 0) grenadeExplode(g);
      }
      if (grenades.length > 0) requestAnimationFrame(grenadeStep);
    }
    function throwGrenade() {
      if (nades <= 0 || !G.player || !G.player.alive) return;
      nades--;
      try {
        const cam = G.camera;
        const dir = cam.getWorldDirection(cam.position.clone());
        const geo = BoxGeoC ? new BoxGeoC(0.09, 0.11, 0.09) : null;
        const mat = new MatC({ color: 0x2d3540, roughness: 0.5, metalness: 0.4 });
        const mesh = new MeshC(geo, mat);
        mesh.position.copy(cam.position).addScaledVector(dir, 0.5).add(new (dir.constructor)(0, -0.12, 0));
        G.render.scene.add(mesh);
        const vel = dir.multiplyScalar(GRENADE.speed).add(new (dir.constructor)(0, GRENADE.up, 0));
        if (G.player.vel) vel.add(G.player.vel);
        grenades.push({ mesh, vel, fuse: GRENADE.fuse });
        feedAdd('手雷投出 · 剩余 ' + nades);
        if (grenades.length === 1) requestAnimationFrame(grenadeStep);
      } catch (e) { console.error('[slx] grenade throw', e); }
    }
    function resetNades() {
      nades = 3;
      for (const g of grenades.slice()) grenadeExplode(g);
    }
    if (G.events && G.events.on) G.events.on('player:dead', resetNades);

    /* ================= 4) 击杀播报（原版事件总线 enemy:killed → 信息流） ================= */
    if (G.events && G.events.on) {
      G.events.on('enemy:killed', (e) => {
        const n = e && e.type === 'gull' ? '海鸥已击落' : e && e.type === 'hound' ? '猎犬已击落' : '目标已击落';
        feedAdd(n);
      });
    }

    /* ================= 5) 战绩存档（runs/wins/deaths/最佳评级/最快用时/累计击毁） =================
       通过轮询 t.game.state 识别“出击/通关/阵亡”三个转移点；通关数据直接读结算屏 DOM
       （data-f=time/acc/kills/retries/rating），不侵入原版游戏状态机。 */
    const RATING_NAMES = ['混乱', '喧闹', '稳健', '干净', '犀利', '手术刀'];
    const RATING_IDX = { '混乱': 0, '喧闹': 1, '稳健': 2, '干净': 3, '犀利': 4, '手术刀': 5 };
    store.records = store.records || { runs: 0, wins: 0, deaths: 0, bestTime: null, bestRating: -1, totalKills: 0 };
    let prevState = null;
    function recordsText() {
      const r = store.records, bits = ['出击 ' + r.runs, '通关 ' + r.wins, '阵亡 ' + r.deaths];
      if (r.bestRating >= 0) bits.push('最佳评级 ' + RATING_NAMES[r.bestRating]);
      if (r.bestTime != null) bits.push('最快 ' + Math.floor(r.bestTime / 60) + ':' + String(r.bestTime % 60).padStart(2, '0'));
      bits.push('累计击毁 ' + r.totalKills);
      return bits.join(' · ');
    }
    let recLine = null;
    function updateRecordsLine() {
      const host = document.querySelector('.m-title-main');
      if (!host) return;
      if (!recLine || !document.body.contains(recLine)) {
        recLine = document.createElement('p');
        recLine.className = 'm-note slx-records';
        host.appendChild(recLine);
      }
      recLine.textContent = '战绩：' + recordsText();
    }
    setInterval(() => {
      const st = G.game && G.game.state;
      if (st === prevState) return;
      if (st === 'playing' && ['title', 'dead', 'complete'].includes(prevState)) { store.records.runs++; save(); nades = 3; }
      if (st === 'dead' && prevState === 'playing') { store.records.deaths++; save(); }
      if (st === 'complete' && prevState === 'playing') {
        store.records.wins++;
        try {
          const q = f => { const el = document.querySelector('[data-f="' + f + '"]'); return el ? el.textContent : ''; };
          const mm = /^(\d+):(\d+)$/.exec(q('time'));
          const sec = mm ? (+mm[1] * 60) + (+mm[2]) : null;
          if (sec != null && (store.records.bestTime == null || sec < store.records.bestTime)) store.records.bestTime = sec;
          const ri = RATING_IDX[q('rating')];
          if (ri != null && ri > (store.records.bestRating ?? -1)) store.records.bestRating = ri;
          store.records.totalKills += parseInt(q('kills')) || 0;
        } catch { }
        save();
      }
      if (st === 'title') updateRecordsLine();
      prevState = st;
    }, 400);

    /* ================= 6) 调试面板（F3：FPS / 绘制调用 / 状态 / 坐标） ================= */
    let dbg = null, dbgOn = false, frames = 0, fps = 0;
    (function countFrame() { frames++; requestAnimationFrame(countFrame); })();
    setInterval(() => { fps = frames * 2; frames = 0; }, 500);
    setInterval(() => {
      if (!dbgOn || !dbg) return;
      const st = G.render && G.render.stats ? G.render.stats() : null;
      const p = G.player && G.player.pos;
      dbg.textContent = 'FPS ' + fps
        + '\nDRAW ' + (st && st.calls != null ? st.calls : '-')
        + '  TRI ' + (st && st.tris != null ? st.tris : '-')
        + '\nSTATE ' + ((G.game && G.game.state) || '-')
        + '\nPOS ' + (p ? p.x.toFixed(1) + ', ' + p.y.toFixed(1) + ', ' + p.z.toFixed(1) : '-');
    }, 500);
    function toggleDebug() {
      if (!dbg) {
        dbg = document.createElement('div');
        dbg.style.cssText = 'position:absolute;left:12px;bottom:12px;z-index:40;display:none;'
          + 'font:500 11px/1.7 var(--f-mono);color:var(--bone);background:var(--plate-solid);'
          + 'border:1px solid var(--line);padding:8px 10px;pointer-events:none;white-space:pre';
        document.getElementById('ui').appendChild(dbg);
      }
      dbgOn = !dbgOn;
      dbg.style.display = dbgOn ? 'block' : 'none';
    }

    /* 对外调试/验证接口（与原版 __G/__stats 调试出口同一思路） */
    window.SLX = {
      version: '1.2',
      records: store.records,
      get nades() { return nades; },
      get layout() { return layoutIdx; },
      showDamage, feedAdd, toggleDebug, updateRecordsLine,
    };

    /* ================= 按键（仅游玩状态生效，与原版 keydown 守卫一致） ================= */
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const G2 = window.__G;
      if (!G2 || !G2.game || G2.game.state !== 'playing') return;
      switch (e.code) {
        case 'Digit1': select(0); break;
        case 'Digit2': select(1); break;
        case 'Digit3': select(2); break;
        case 'KeyG': throwGrenade(); break;
        case 'KeyM': applyLayout((layoutIdx + 1) % LAYOUTS.length); break;
        case 'KeyT': applyTheme((themeIdx + 1) % THEMES.length); break;
        case 'KeyO': store.xcolor = ((store.xcolor | 0) + 1) % XCOLORS.length; applyXhair(); save(); break;
        case 'KeyN': store.xdot = !store.xdot; applyXhair(); save(); break;
        case 'F3': e.preventDefault(); toggleDebug(); break;
      }
    });

    /* 应用持久化状态 */
    if (themeIdx !== 0) applyTheme(themeIdx, true);
    applyXhair();
    log('loadout=' + LOADOUTS[cur].name, 'theme=' + (themeIdx === 0 ? 'dusk' : THEMES[themeIdx].label));
  }

  boot();
})();
