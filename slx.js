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
 *   Digit1-9 / KeyX / KeyZ  —— TIDEBREAK 武器库 18 把切换（数值+配件外观，v3.0）
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
    let MeshC = null, MatC = null, ColorC = null, BoxGeoC = null, GroupC = null;
    GroupC = G.weapon.root.constructor;
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

    /* ================= 1) 武器库（移植自 TIDEBREAK 断潮 WEAPONS 表，18 把 × 6 类） =================
       数值来源：tidebreak_project/build/art2.html 的 WEAPONS 数据表（伤害/射速/弹匣/备弹/换弹/散布/后坐/多弹丸）。
       实现通道（全部运行时挂接，主脚本零逻辑改动）：
       - 弹匣/备弹/名称：ve 活属性（换弹补弹按 ve.magSize 原生生效，已实测）
       - 伤害：playerShot 包装器按 dmgMul = dmg/26 缩放（原版伤害闭包常量 26）
       - 射速：input.fire 属性门控（defineProperty getter 按各武器 RPM 节流，已实测 400RPM→164ms 间隔）
       - 全自动/半自动：auto=false 时上升沿单发
       - 霰弹多弹丸：监听 weapon:fire 事件由 SLX 补射剩余弹丸
       - 散布：引擎每帧重写 ve.spread（基准 .0125+bloom），update 里按 spreadHip/0.0125 比例收敛
       - 换弹时长：ve.debug.reloadT 外部驱动（按自身时长/T 原版时长比例推进，动画同步压缩）
       - 后坐近似：weapon:fire 时按 recoilV 叠加屏幕震动
       - 外观：配件系统（消音/瞄镜/长枪管/枪托/弹鼓）+ 涂装取 TIDEBREAK accent 色
       硬上限：引擎射击循环封顶 720 RPM，>720 的武器（M18/S12/V9/MG5）按 720 生效。 */
    const TB_WEAPONS = [
      { id: 'P9',  name: 'P9 渡鸦',   cat: '手枪', dmg: 26,  rpm: 400, mag: 20,  reserve: 120, reload: 1.85, spreadHip: 0.0135, recoilV: 0.55, auto: false, pellets: 1, paint: null,      kit: [] },
      { id: 'R45', name: 'R45 铁砧',  cat: '手枪', dmg: 58,  rpm: 150, mag: 8,   reserve: 48,  reload: 2.55, spreadHip: 0.0175, recoilV: 1.65, auto: false, pellets: 1, paint: 0x8a7340, kit: [] },
      { id: 'M18', name: 'M18 蜂鸟',  cat: '手枪', dmg: 18,  rpm: 900, mag: 18,  reserve: 108, reload: 1.95, spreadHip: 0.0180, recoilV: 0.48, auto: true,  pellets: 1, paint: null,      kit: ['suppressor'] },
      { id: 'V9',  name: 'V9 潮汐',   cat: '冲锋枪', dmg: 24, rpm: 800, mag: 30,  reserve: 150, reload: 2.10, spreadHip: 0.0125, recoilV: 0.52, auto: true,  pellets: 1, paint: null,      kit: ['suppressor', 'stock'] },
      { id: 'S12', name: 'S12 砂砾',  cat: '冲锋枪', dmg: 19, rpm: 1000, mag: 25, reserve: 125, reload: 1.80, spreadHip: 0.0170, recoilV: 0.44, auto: true,  pellets: 1, paint: null,      kit: ['longbarrel', 'stock'] },
      { id: 'U3',  name: 'U3 短鳍',   cat: '冲锋枪', dmg: 28, rpm: 640, mag: 32,  reserve: 160, reload: 2.30, spreadHip: 0.0105, recoilV: 0.62, auto: true,  pellets: 1, paint: null,      kit: ['foregrip', 'stock'] },
      { id: 'AR7', name: 'AR7 铁砧',  cat: '步枪', dmg: 36,  rpm: 600, mag: 30,  reserve: 150, reload: 2.50, spreadHip: 0.0100, recoilV: 1.90, auto: true,  pellets: 1, paint: null,      kit: ['longbarrel', 'foregrip', 'stock'] },
      { id: 'CR4', name: 'CR4 潮痕',  cat: '步枪', dmg: 30,  rpm: 666, mag: 30,  reserve: 150, reload: 2.20, spreadHip: 0.0088, recoilV: 1.20, auto: true,  pellets: 1, paint: null,      kit: ['longbarrel', 'stock'] },
      { id: 'SC9', name: 'SC9 獾式',  cat: '步枪', dmg: 45,  rpm: 400, mag: 20,  reserve: 120, reload: 2.40, spreadHip: 0.0092, recoilV: 1.55, auto: false, pellets: 1, paint: null,      kit: ['scope', 'longbarrel', 'stock'] },
      { id: 'SR1', name: 'SR1 长钉',  cat: '狙击', dmg: 115, rpm: 41,  mag: 10,  reserve: 50,  reload: 3.40, spreadHip: 0.0420, recoilV: 3.20, auto: false, pellets: 1, paint: null,      kit: ['scope', 'longbarrel', 'stock'] },
      { id: 'SR5', name: 'SR5 灰鹭',  cat: '狙击', dmg: 72,  rpm: 60,  mag: 10,  reserve: 60,  reload: 2.80, spreadHip: 0.0340, recoilV: 2.20, auto: false, pellets: 1, paint: null,      kit: ['scope', 'longbarrel', 'stock'] },
      { id: 'DM7', name: 'DM7 哨兵',  cat: '狙击', dmg: 58,  rpm: 180, mag: 20,  reserve: 100, reload: 2.60, spreadHip: 0.0180, recoilV: 1.80, auto: false, pellets: 1, paint: null,      kit: ['scope', 'longbarrel', 'stock'] },
      { id: 'SG8', name: 'SG8 碎石',  cat: '霰弹', dmg: 22,  rpm: 85,  mag: 8,   reserve: 40,  reload: 3.00, spreadHip: 0.0520, recoilV: 3.00, auto: false, pellets: 8, paint: null,      kit: ['longbarrel', 'foregrip'] },
      { id: 'SA7', name: 'SA7 鬃刷',  cat: '霰弹', dmg: 16,  rpm: 200, mag: 7,   reserve: 35,  reload: 3.20, spreadHip: 0.0600, recoilV: 2.40, auto: false, pellets: 8, paint: null,      kit: ['longbarrel', 'foregrip'] },
      { id: 'DB2', name: 'DB2 短管',  cat: '霰弹', dmg: 30,  rpm: 120, mag: 2,   reserve: 20,  reload: 2.40, spreadHip: 0.0700, recoilV: 4.00, auto: false, pellets: 10, paint: null,     kit: ['foregrip'] },
      { id: 'LM1', name: 'LM1 压舱石', cat: '机枪', dmg: 30, rpm: 750, mag: 100, reserve: 200, reload: 5.20, spreadHip: 0.0150, recoilV: 1.50, auto: true,  pellets: 1, paint: null,      kit: ['drum', 'longbarrel', 'stock'] },
      { id: 'LM8', name: 'LM8 锚链',  cat: '机枪', dmg: 40,  rpm: 650, mag: 80,  reserve: 160, reload: 5.60, spreadHip: 0.0130, recoilV: 2.10, auto: true,  pellets: 1, paint: null,      kit: ['drum', 'longbarrel', 'stock'] },
      { id: 'MG5', name: 'MG5 龙门',  cat: '机枪', dmg: 26,  rpm: 900, mag: 120, reserve: 240, reload: 5.00, spreadHip: 0.0170, recoilV: 1.10, auto: true,  pellets: 1, paint: null,      kit: ['drum', 'longbarrel', 'stock'] },
    ];
    const saved = {};
    for (const w of TB_WEAPONS) saved[w.id] = { ammo: null, reserve: null };

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
      const wood = new MatC({ color: 0x4a3d2c, roughness: 0.75, metalness: 0.1 });
      kitMeshes.suppressor = mk(0.034, 0.034, 0.12, 0, 0, -0.585, dark);
      kitMeshes.scope = mk(0.030, 0.030, 0.090, 0, 0.095, -0.100, dark2);
      /* TIDEBREAK 类别配件（视觉区分用）：长枪管 / 枪托 / 弹鼓 / 前握把 */
      kitMeshes.longbarrel = mk(0.022, 0.022, 0.22, 0, 0.006, -0.700, dark);
      kitMeshes.stock = mk(0.030, 0.046, 0.14, 0, -0.058, 0.135, wood);
      kitMeshes.drum = mk(0.052, 0.085, 0.052, 0, -0.093, -0.210, dark2);
      kitMeshes.foregrip = mk(0.026, 0.052, 0.026, 0, -0.050, -0.380, dark);
      for (const k in kitMeshes) { G.weapon.root.add(kitMeshes[k]); kitMeshes[k].visible = false; }
    } else {
      log('kit unavailable: constructors missing');
    }

    /* PAC-9 原版腰射基准散布（引擎每帧重写 ve.spread 的基准值），用于换算各武器散布比例 */
    const PAC9_HIP = 0.0125;
    let cur = 0;

    function applyWeapon(idx) {
      const ve = G.weapon, c = TB_WEAPONS[idx], s = saved[c.id];
      cur = idx;
      ve.name = c.name;
      ve.magSize = c.mag;
      ve.reserve = s.reserve != null ? s.reserve : c.reserve;
      ve.ammo = s.ammo != null ? Math.max(0, Math.min(s.ammo, c.mag)) : c.mag;
      for (const [mat, orig] of mat0) {
        if (c.paint) mat.color.copy(orig).lerp(new ColorC(c.paint), 0.55);
        else mat.color.copy(orig);
      }
      for (const k in kitMeshes) kitMeshes[k].visible = c.kit.includes(k);
      store.weapon = c.id; save();
    }

    let switching = 0, shown = true;

    function select(idx) {
      if (switching || idx === cur || idx < 0 || idx >= TB_WEAPONS.length) return;
      switching = 1;
      saved[TB_WEAPONS[cur].id].ammo = G.weapon.ammo;
      saved[TB_WEAPONS[cur].id].reserve = G.weapon.reserve;
      api.setVisible(false); /* 直接操作原实例：绕过包装器，避免污染 shown 标志 */
      setTimeout(() => {
        applyWeapon(idx);
        api.setVisible(shown);
        switching = 0;
        toast(TB_WEAPONS[cur].name + ' · ' + TB_WEAPONS[cur].cat);
      }, 340);
    }
    function selectById(id) {
      const i = TB_WEAPONS.findIndex(w => w.id === id);
      if (i >= 0) select(i);
    }
    function cycleWeapon(dir) {
      select((cur + dir + TB_WEAPONS.length) % TB_WEAPONS.length);
    }

    /* 武器控制器：主循环/HUD/战斗读取 t.weapon —— 透传到原版武器实例，
       每帧按当前武器散布比例收敛（原版 ve.spread 由武器内部每帧重写），
       并驱动换弹进度（ve.debug.reloadT）实现按武器的换弹时长 */
    const api = G.weapon;
    const ctrl = {
      update(dt) {
        api.update(dt);
        const c = TB_WEAPONS[cur];
        /* 散布收敛：引擎基准 .0125，乘以当前武器 spreadHip 比例 */
        if (isFinite(api.spread)) api.spread *= c.spreadHip / PAC9_HIP;
        /* 换弹时长驱动：按 自身时长/T原版时长 比例推进动画（t=比例×T，到时释放由引擎完成） */
        try {
          const dbg = api.debug;
          if (dbg && dbg.reloadT != null && reloadDrive.on) {
            const T = reloadDrive.empty ? 2.72 : 2.1; /* 原版 G_/W_ 常量 */
            const p = (performance.now() - reloadDrive.t0) / (c.reload * 1000);
            if (p >= 1) { dbg.reloadT = null; reloadDrive.on = false; }
            else dbg.reloadT = Math.min(T, p * T);
          }
        } catch { }
      },
      setVisible(v) { shown = !!v; if (!switching) api.setVisible(shown); },
      setWetness(w) { if (api.setWetness) api.setWetness(w); },
      muzzleWorld(v) { return api.muzzleWorld ? api.muzzleWorld(v) : v; },
      snap() { return api.snap ? api.snap() : undefined; },
      reload() { return api.reload ? api.reload() : undefined; },
      reset() {
        for (const k in saved) { saved[k].ammo = null; saved[k].reserve = null; }
        if (api.reset) api.reset();
        applyWeapon(cur);
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
    /* 初始武器：按 localStorage 记忆恢复，非法值回退 P9 */
    {
      const want = TB_WEAPONS.findIndex(w => w.id === store.weapon);
      applyWeapon(want >= 0 ? want : 0);
    }

    /* ================= 1a) 射速门控（input.fire 属性拦截） =================
       原版射击循环每帧动态读 i.input.fire（已实测），用 defineProperty 拦截：
       setter 保存输入模块写入的原始开火状态，getter 按当前武器射速节流放行。
       全自动：按 60000/rpm 间隔放行；半自动：上升沿单发。
       引擎自身封顶 720 RPM，>720 的武器按 720 生效。 */
    const fireGate = { raw: false, semiOpen: false, lastAllow: 0 };
    try {
      const input = G.input;
      if (input && 'fire' in input) {
        Object.defineProperty(input, 'fire', {
          configurable: true,
          get() {
            const c = TB_WEAPONS[cur];
            if (!fireGate.raw || !c) return false;
            if (!c.auto) {
              if (fireGate.semiOpen) { fireGate.semiOpen = false; return true; }
              return false;
            }
            const iv = 60000 / Math.min(c.rpm, 720);
            const now = performance.now();
            if (now - fireGate.lastAllow >= iv) { fireGate.lastAllow = now; return true; }
            return false;
          },
          set(v) {
            const nv = !!v;
            if (nv && !fireGate.raw) fireGate.semiOpen = true; /* 上升沿：半自动放行一次 */
            fireGate.raw = nv;
          },
        });
      } else log('fire gate unavailable: input missing');
    } catch (e) { log('fire gate error: ' + e.message); }

    /* ================= 1b-2) 霰弹多弹丸 + 后坐近似 + 换弹时长登记 ================= */
    let pelletBypass = false; /* 霰弹补射标志：模块级闭包，不挂函数属性（防第三方包装遮蔽） */
    if (G.events && G.events.on) {
      G.events.on('weapon:fire', e => {
        const c = TB_WEAPONS[cur];
        if (!c) return;
        /* 霰弹：首颗弹丸由引擎打出（伤害经包装器缩放），SLX 补射剩余弹丸（原始伤害直通） */
        if (c.pellets > 1 && G.combat && G.combat.playerShot && G.THREE && e && e.origin && e.dir) {
          const shot = G.combat.playerShot;
          const THREEr = G.THREE;
          pelletBypass = true;
          try {
            const dir = e.dir.clone(), up = new THREEr.Vector3(0, 1, 0);
            const right = dir.clone().cross(up).normalize();
            const upv = right.clone().cross(dir).normalize();
            for (let i = 1; i < c.pellets; i++) {
              const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * c.spreadHip * 3;
              const d2 = dir.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(upv, Math.sin(a) * r).normalize();
              shot(e.origin, d2, { damage: c.dmg, range: 48 });
            }
          } catch { } finally { pelletBypass = false; }
        }
        /* 后坐近似：原版枪感是 PAC-9 手枪级（recoilV≈.55），按各武器 recoilV 叠加屏幕震动 */
        try {
          if (G.player && G.player.addShake && c.recoilV > 0.6) G.player.addShake(Math.min(0.5, (c.recoilV - 0.55) * 0.16));
        } catch { }
      });
      /* 换弹时长：start 事件登记空匣/战术与起始时间，update 里驱动 reloadT */
      G.events.on('weapon:reload', e => {
        if (e && e.phase === 'start') reloadDrive.on = true, reloadDrive.t0 = performance.now(), reloadDrive.empty = !!e.empty;
        else if (e && e.phase === 'done') reloadDrive.on = false;
      });
    }
    const reloadDrive = { on: false, t0: 0, empty: false };

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
        const c = TB_WEAPONS[cur];
        const mul = pelletBypass ? 1 : (c ? c.dmg / 26 : 1); /* 原版伤害闭包常量 26；霰弹补射直通 */
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
       切换布局 = 换 seed 并重载；不同 seed 生成不同的集装箱堆叠布局。
       v2：store.seed 为唯一数据源（联机房间会同步 seed）。 */
    const LAYOUTS = [
      { seed: 4207,  label: '港区 · 标准布局' },
      { seed: 31337, label: '港区 · 变体 α' },
      { seed: 90210, label: '港区 · 变体 β' },
    ];
    store.seed = Number(store.seed ?? 4207);
    function currentSeed() {
      const u = Number(new URLSearchParams(location.search).get('seed'));
      return isFinite(u) ? u : 4207;
    }
    function layoutLabel(seed) {
      const l = LAYOUTS.find(x => x.seed === seed);
      return l ? l.label : '自定义布局 #' + seed;
    }
    function applySeed(seed, silent) {
      store.seed = Number(seed) || 4207; save();
      const u = new URLSearchParams(location.search);
      u.set('seed', String(store.seed));
      if (!silent) toast('布局已切换：' + layoutLabel(store.seed) + '（重开后生效）');
      setTimeout(() => { location.search = u.toString(); }, silent ? 0 : 700);
    }
    function cycleLayout() {
      const idx = LAYOUTS.findIndex(x => x.seed === store.seed);
      const next = LAYOUTS[(idx + 1 + LAYOUTS.length) % LAYOUTS.length];
      applySeed(next.seed);
    }
    /* 启动时若记忆布局与当前 URL 不符且 URL 未显式带 seed，则静默应用一次（无循环：
       应用后 URL 携带 seed，后续刷新直接命中） */
    if (currentSeed() !== store.seed && !new URLSearchParams(location.search).has('seed')) {
      applySeed(store.seed, true);
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

    /* ================= 7) 联机 v2.0（影式协作，TIDEBREAK NET 架构移植） =================
       共享空间层：房间创建/加入（4 位房间码）、玩家状态 15Hz 同步、远程角色渲染
       （程序化人形 + 姓名牌）、断线自动重连回归（同房间同名复用槽位）、房间 seed
       一致性校验（加入者自动跟随房主布局）。敌人与中继目标由各客户端本地模拟；
       不连接服务器时 v1 单机体验完全不变。 */
    const NET_URL = String(store.netUrl || (location.protocol.indexOf('http') === 0 ? 'ws://' + location.host : 'ws://127.0.0.1:8787'));
    const NET = {
      ws: null, room: null, id: null, status: '离线 · 单机',
      remotes: new Map(), retries: 0, timer: null,
    };
    store.netName = store.netName || ('玩家' + (10 + (Math.random() * 89 | 0)));
    const AV_COLORS = [0x9fb3c8, 0xd2622a, 0x5a8fbf, 0x9e6dbf, 0x59a05e, 0xbf5a70];
    let nameLayer = null;

    function baseHttp() { return NET_URL.replace(/^ws(s)?:\/\//, (m, s1) => s1 ? 'https://' : 'http://'); }
    function netSend(obj) {
      if (NET.transport === 'sse') {
        if (!NET.room) return;
        try { fetch(baseHttp() + '/net-post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room: NET.room, name: NET.name, payload: obj }) }).catch(() => { }); } catch { }
        return;
      }
      if (NET.ws && NET.ws.readyState === 1) NET.ws.send(JSON.stringify(obj));
    }
    function updateNetChip() {
      let chip = document.getElementById('slx-net-chip');
      if (!chip) {
        chip = document.createElement('div');
        chip.id = 'slx-net-chip';
        chip.style.cssText = 'position:absolute;right:14px;top:calc(16px + var(--sat,0px) + 56px);z-index:7;'
          + 'font:500 11px/1 var(--f-mono);letter-spacing:.04em;color:var(--bone);background:var(--plate-solid);'
          + 'border:1px solid var(--line);padding:5px 8px;pointer-events:auto;cursor:pointer';
        chip.addEventListener('click', () => { const pn = document.getElementById('slx-net-panel'); if (pn) pn.style.display = pn.style.display === 'none' ? 'block' : 'none'; });
        document.getElementById('ui').appendChild(chip);
      }
      chip.textContent = NET.room ? ('联机 ' + NET.room + ' · ' + (NET.remotes.size + 1) + ' 人 · ' + NET.status)
        : ('联机 · ' + NET.status);
    }
    function makeAvatar(colorIdx) {
      const g = new GroupC();
      const body = new MatC({ color: AV_COLORS[colorIdx % AV_COLORS.length], roughness: 0.7, metalness: 0.1 });
      const dark = new MatC({ color: 0x1d2226, roughness: 0.8, metalness: 0.1 });
      const add = (w, h, d, x, y, z, mat) => {
        const m = new MeshC(new BoxGeoC(w, h, d), mat);
        m.position.set(x, y, z); m.castShadow = false; m.receiveShadow = false;
        g.add(m);
        return m;
      };
      add(0.44, 0.58, 0.26, 0, 1.15, 0, body);          // 躯干
      add(0.24, 0.24, 0.24, 0, 1.62, 0, body);          // 头
      add(0.15, 0.55, 0.18, -0.13, 0.30, 0, dark);      // 左腿
      add(0.15, 0.55, 0.18, 0.13, 0.30, 0, dark);       // 右腿
      add(0.05, 0.05, 0.52, 0.16, 1.28, -0.18, dark);   // 枪
      return g;
    }
    function ensureRemote(id, name) {
      let r = NET.remotes.get(id);
      if (r) { if (name) r.name = name; return r; }
      const colorIdx = (Number(id) - 1) || 0;
      const mesh = makeAvatar(colorIdx);
      G.render.scene.add(mesh);
      if (!nameLayer) {
        nameLayer = document.createElement('div');
        nameLayer.id = 'slx-names';
        nameLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:6';
        document.getElementById('ui').appendChild(nameLayer);
      }
      const plate = document.createElement('div');
      plate.style.cssText = 'position:absolute;transform:translate(-50%,-100%);white-space:nowrap;'
        + 'font:500 11px/1.5 var(--f-mono);color:var(--bone);background:var(--plate-solid);'
        + 'border:1px solid var(--line);padding:2px 6px;text-align:center';
      nameLayer.appendChild(plate);
      r = {
        name: name || ('玩家' + id), mesh, plate,
        target: new (G.player.pos.constructor)(0, 0, 0), yaw: 0, hp: 100, al: 1, wn: '', am: 0,
        seen: performance.now(),
      };
      mesh.visible = false; plate.style.display = 'none';
      NET.remotes.set(id, r);
      return r;
    }
    function removeRemote(id) {
      const r = NET.remotes.get(id);
      if (!r) return;
      try { if (r.mesh) G.render.scene.remove(r.mesh); } catch { }
      r.plate.remove();
      NET.remotes.delete(id);
      updateNetChip();
    }
    function clearRemotes() { for (const id of [...NET.remotes.keys()]) removeRemote(id); }
    function onNetMsg(m) {
      if (!m || typeof m.t !== 'string') return;
      if (m.t !== 'p') console.log('[slx][net]', m.t, 'id=' + m.id, 'name=' + (m.name || ''));
      switch (m.t) {
        case 'joined': {
          NET.room = m.code; NET.id = m.id; NET.retries = 0;
          store.netRoom = m.code; save();
          NET.status = m.rejoin ? '重连回归' : '已连接';
          feedAdd(m.rejoin ? '重连回归：' + m.code : '已进入房间 ' + m.code);
          const cur = currentSeed();
          if (Number(m.seed) !== cur) { store.seed = Number(m.seed); save(); applySeed(Number(m.seed), true); }
          for (const pl of (m.players || [])) {
            if (pl.id === m.id) continue;
            const r = ensureRemote(pl.id, pl.name);
            if (pl.last) { r.target.set(pl.last.p[0], pl.last.p[1], pl.last.p[2]); r.yaw = pl.last.yaw || 0; r.hp = pl.last.hp | 0; r.al = pl.last.al; }
          }
          break;
        }
        case 'peerjoin': NET.names = NET.names || {}; NET.names[m.id] = m.name; feedAdd((m.name || '玩家') + ' 加入了房间'); break;
        case 'rejoin': feedAdd((m.name || '玩家') + ' 重连回归'); break;
        case 'p': {
          const r = ensureRemote(m.id, m.name);
          r.seen = performance.now();
          r.target.set(m.p[0], m.p[1], m.p[2]);
          r.yaw = m.yaw || 0; r.hp = m.hp | 0; r.al = m.al; r.wn = m.wn || ''; r.am = m.am | 0;
          r.mesh.visible = !!r.al;
          break;
        }
        case 'dc': { const r = NET.remotes.get(m.id); if (r) r.plate.textContent = r.name + '（断线）'; break; }
        case 'leave': removeRemote(m.id); feedAdd((m.name || '玩家') + ' 离开了'); break;
        case 'x': feedAdd((NET.names && NET.names[m.id] ? NET.names[m.id] + '：' : '') + (m.msg || '')); break;
        case 'err': toast(m.msg || '联机出错'); NET.status = '出错'; break;
      }
      updateNetChip();
    }
    function netConnect(mode, roomCode) {
      NET.name = store.netName;
      NET.pendingMode = mode;
      NET.pendingRoom = roomCode || store.netRoom || '';
      NET.transport = 'ws';
      try { NET.ws = new WebSocket(NET_URL); } catch { return sseFallback(); }
      NET.status = '连接中'; updateNetChip();
      NET.ws.onopen = () => {
        NET.transport = 'ws';
        netSend({ t: mode === 'create' ? 'create' : 'join', name: NET.name, room: NET.pendingRoom, seed: currentSeed() });
      };
      NET.ws.onmessage = ev => { try { onNetMsg(JSON.parse(ev.data)); } catch { } };
      NET.ws.onclose = () => {
        NET.ws = null;
        sseFallback(); /* 首连被拦（LNA/代理）或已入房断开 → SSE 通道接管（其自动重连会按名回归） */
      };
    }
    function sseFallback() {
      NET.transport = 'sse';
      NET.status = '连接中（HTTP 通道）'; updateNetChip();
      const q = new URLSearchParams();
      q.set('name', NET.name);
      q.set('seed', String(currentSeed()));
      if (NET.pendingRoom) q.set('room', NET.pendingRoom);
      try { NET.es = new EventSource(baseHttp() + '/net-stream?' + q.toString()); }
      catch { NET.status = '离线 · 单机'; updateNetChip(); return; }
      NET.es.onmessage = ev => { try { onNetMsg(JSON.parse(ev.data)); } catch { } };
      NET.es.onerror = () => {
        if (!NET.es || NET.es.readyState === 2) { NET.status = '离线（中继不可达）'; clearRemotes(); updateNetChip(); }
        else { NET.status = '重连中'; updateNetChip(); }
      };
    }
    function scheduleRejoin() {
      if (NET.retries >= 5) { NET.status = '离线（重连失败）'; updateNetChip(); return; }
      const delay = 1000 * Math.pow(2, NET.retries++);
      setTimeout(() => { if (!NET.ws && NET.room) netConnect('join'); }, delay);
    }
    function netLeave() {
      if (NET.room) netSend({ t: 'leave' });
      NET.room = null; NET.id = null; NET.status = '离线 · 单机';
      store.netRoom = ''; save();
      clearRemotes();
      if (NET.ws) NET.ws.close();
      updateNetChip();
    }
    /* 状态广播 15Hz（仅联机时） */
    setInterval(() => {
      if (!NET.room || !G.player) return;
      const p = G.player.pos;
      netSend({
        t: 's',
        p: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)],
        yaw: +G.player.yaw.toFixed(2),
        hp: G.player.health | 0,
        al: G.player.alive ? 1 : 0,
        wn: (G.weapon && G.weapon.name) || '',
        am: (G.weapon && G.weapon.ammo) | 0,
      });
    }, 66);
    /* 远程角色插值渲染 + 姓名牌（常驻低频循环） */
    (function netFrame() {
      for (const r of NET.remotes.values()) {
        if (!r.mesh) continue;
        r.mesh.position.lerp(r.target, 0.35);
        r.mesh.rotation.y = r.yaw || 0;
        const v = r.mesh.position.clone(); v.y += 2.05; v.project(G.camera);
        if (v.z > 1) { r.plate.style.display = 'none'; continue; }
        r.plate.style.display = 'block';
        r.plate.style.left = (((v.x * 0.5 + 0.5) * innerWidth) | 0) + 'px';
        r.plate.style.top = (((-v.y * 0.5 + 0.5) * innerHeight) | 0) + 'px';
        r.plate.textContent = r.name + '  HP ' + r.hp + (r.al ? '' : '（阵亡）');
        r.plate.style.opacity = r.al ? '1' : '0.5';
        if (performance.now() - r.seen > 3000) r.mesh.visible = false;
      }
      requestAnimationFrame(netFrame);
    })();
    /* 联机小面板（KeyU 开关，点状态条也可开） */
    function ensureNetPanel() {
      let pn = document.getElementById('slx-net-panel');
      if (pn) return pn;
      pn = document.createElement('div');
      pn.id = 'slx-net-panel';
      pn.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:50;display:none;'
        + 'background:var(--plate-solid);border:1px solid var(--line);padding:16px 18px;min-width:320px;'
        + 'font:500 13px/1.8 var(--f-mono);color:var(--bone)';
      pn.innerHTML = `
        <div style="font:600 14px/1 var(--f-label);letter-spacing:.2em;margin-bottom:10px">联机 · 影式协作</div>
        <label style="display:block">昵称 <input id="slx-net-name" maxlength="10" style="width:150px;background:var(--ink-2);border:1px solid var(--line);color:var(--bone);font:inherit;padding:4px 6px"></label>
        <label style="display:block">中继服务器 <input id="slx-net-url" style="width:220px;background:var(--ink-2);border:1px solid var(--line);color:var(--bone);font:inherit;padding:4px 6px"></label>
        <div style="margin:10px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button data-slx="create" style="cursor:pointer;background:var(--ink-2);border:1px solid var(--line);color:var(--bone);font:inherit;padding:4px 10px">创建房间</button>
          <input id="slx-net-code" maxlength="4" placeholder="房间码" style="width:70px;background:var(--ink-2);border:1px solid var(--line);color:var(--bone);font:inherit;padding:4px 6px;text-transform:uppercase">
          <button data-slx="join" style="cursor:pointer;background:var(--ink-2);border:1px solid var(--line);color:var(--bone);font:inherit;padding:4px 10px">加入</button>
          <button data-slx="leave" style="cursor:pointer;background:var(--ink-2);border:1px solid var(--line);color:var(--bone);font:inherit;padding:4px 10px">离开</button>
        </div>
        <p style="font:400 11px/1.6 var(--f-mono);color:var(--steel);margin:0">影式协作：共享空间与数据同步；敌人与中继由各自客户端本地模拟。需先启动中继服务器：<br>node server/index.js（默认 ws://localhost:8787）</p>`;
      document.getElementById('ui').appendChild(pn);
      pn.querySelector('#slx-net-name').value = store.netName;
      pn.querySelector('#slx-net-url').value = NET_URL;
      pn.querySelector('#slx-net-name').addEventListener('change', e => { store.netName = e.target.value.trim() || store.netName; save(); });
      pn.querySelector('#slx-net-url').addEventListener('change', e => { store.netUrl = e.target.value.trim(); save(); });
      pn.querySelector('[data-slx="create"]').addEventListener('click', () => netConnect('create'));
      pn.querySelector('[data-slx="join"]').addEventListener('click', () => {
        const code = (pn.querySelector('#slx-net-code').value || '').trim().toUpperCase();
        if (!code) { toast('请输入房间码'); return; }
        netConnect('join', code);
      });
      pn.querySelector('[data-slx="leave"]').addEventListener('click', netLeave);
      return pn;
    }

    /* 对外调试/验证接口（与原版 __G/__stats 调试出口同一思路） */
    window.SLX = {
      version: '3.0',
      records: store.records,
      get nades() { return nades; },
      get seed() { return store.seed; },
      get weapon() { return { id: TB_WEAPONS[cur].id, name: TB_WEAPONS[cur].name, cat: TB_WEAPONS[cur].cat }; },
      get weapons() { return TB_WEAPONS.map(w => w.id + ' ' + w.name); },
      net: { get room() { return NET.room; }, get id() { return NET.id; }, get status() { return NET.status }, get remotes() { return [...NET.remotes.keys()]; } },
      select, cycleWeapon,
      showDamage, feedAdd, toggleDebug, updateRecordsLine, netConnect, netLeave,
    };

    /* ================= 按键（仅游玩状态生效，与原版 keydown 守卫一致） ================= */
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const G2 = window.__G;
      if (!G2 || !G2.game || G2.game.state !== 'playing') return;
      switch (e.code) {
        /* 数字键 1-9 快选前九把武器，X/Z 循环全部 18 把（TIDEBREAK 武器库） */
        case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5':
        case 'Digit6': case 'Digit7': case 'Digit8': case 'Digit9': {
          const n = Number(e.code.slice(5)) - 1;
          if (n < TB_WEAPONS.length) select(n);
          break;
        }
        case 'KeyX': cycleWeapon(1); break;
        case 'KeyZ': cycleWeapon(-1); break;
        case 'KeyG': throwGrenade(); break;
        case 'KeyM': cycleLayout(); break;
        case 'KeyT': applyTheme((themeIdx + 1) % THEMES.length); break;
        case 'KeyO': store.xcolor = ((store.xcolor | 0) + 1) % XCOLORS.length; applyXhair(); save(); break;
        case 'KeyN': store.xdot = !store.xdot; applyXhair(); save(); break;
        case 'F3': e.preventDefault(); toggleDebug(); break;
        case 'KeyU': { const pn = ensureNetPanel(); pn.style.display = pn.style.display === 'none' ? 'block' : 'none'; break; }
      }
    });

    /* 应用持久化状态 */
    if (themeIdx !== 0) applyTheme(themeIdx, true);
    applyXhair();
    log('weapon=' + TB_WEAPONS[cur].name + ' (共' + TB_WEAPONS.length + '把)', 'theme=' + (themeIdx === 0 ? 'dusk' : THEMES[themeIdx].label));
  }

  boot();
})();
