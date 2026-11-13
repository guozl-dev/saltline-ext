# SALTLINE 扩展（SLX）变更台账

- 底座：**原版** Saltline `index.html`（来自 `realcodebear/saltline-fable-5.2`，未修改版）
  - 原始 SHA-256：`f34e6debbfa7526b72be2daa24595c2f195e102a7aede4f22e59138c99cd6852`（1,423,569 B）
  - 未使用"几猫"改名版，未使用任何第三方二开分支
- 扩展后：1,433,717 B；底座代码**零改动**，仅追加一段独立 `<script>`（SLX 模块）
- 运行：直接双击 `index.html`，或 `python3 -m http.server` 后打开（冒烟测试用 file:// 通过）
- 源码：`slx.js`（可读源），与 `index.html` 内联副本一致；重新注入命令见文末

---

## 一、新增功能

| # | 功能 | 按键 | 说明 |
|---|---|---|---|
| 1 | **枪械配置切换** | `1` / `2` / `3` | 三套配置共用原版 PAC-9 实例：标准（30 发）/ **SD 消音型**（45 发、散布 ×0.72、消音器+深灰涂装）/ **DMR 精准型**（15 发、散布 ×0.45、瞄准镜块+沙色涂装）。切换有收枪-抬枪过渡（340ms），各配置独立弹药池（切走时保存、切回时恢复）；HUD 武器名/弹匣排/备弹自动跟随 |
| 2 | **昼夜时间主题** | `T` 循环 | 黄昏（原版基准）→ 白天（晴晨，太阳 11.5、曝光 1.06）→ 夜晚（断电风暴，太阳 2.2、曝光 0.82）。改写天空 shader 的 `uZen/uHor/uHorAway/uSunCol/uEnv`、太阳光颜色/强度、渲染曝光 |
| 3 | **准星自定义** | `O` 换色 / `N` 中心点 | 5 色循环 + 中心点开关，注入一条 `.h-cross i` 覆盖规则，不动原 CSS |
| 4 | **击杀播报** | 自动 | 监听原版事件 `enemy:killed`，提示条显示 "Gull down / Hound down" |
| 5 | **设置持久化** | 自动 | 主题/配置/准星状态存 `localStorage("saltline.ext.v1")`；不触碰原版 `saltline.settings.v1` |

## 二、改动位置（唯一）

| 位置 | 改动 |
|---|---|
| `index.html` 文件末尾 `</html>` 之前 | 追加 `<script>`（SLX 模块，约 230 行），原 6,193 行主脚本一字未动 |
| 其余 | 无。HTML/CSS/主脚本/着色器均未修改 |

## 三、挂点依据（全部为原项目官方出口）

| 挂点 | 用途 | 出处（原码偏移） |
|---|---|---|
| `window.__G` | 游戏上下文 | boot：`window.__G=t` |
| `window.__ready` | 装载完成标志 | boot 末段 |
| `t.render.{scene,sun,sky,exposure}` | 主题切换 | 渲染实例 `N={renderer,scene,camera,viewCamera:sun,sky,...}` |
| 天空 shader uniforms | `uZen/uHor/uHorAway/uSunCol/uEnv` | SALTLINE_SKY（`W6` 创建时为独立克隆，可安全改写） |
| `t.weapon`（运行时替换为透传控制器） | 配置切换/散布收敛 | 主循环 `u("weapon",p)` 与 HUD `se(k)` 均动态读取 `i.weapon.*` |
| 武器规格 `mi`（muzzle=[0,0,-.531]、railTop≈.0435） | 配件挂点坐标 | 武器模块常量 |
| `t.events.on("enemy:killed")` | 击杀播报 | 事件总线 `Dy()` |
| `t.hud.message(msg)` | 提示条 | HUD 模块 |
| 武器规格 `mi.name="PAC-9 Longshore"` | HUD 武器名（`ve.name=mi.name`） | dm 工厂 |

## 四、设计约束与已知限制

1. **原逻辑零改动**：扩展只在运行时包装/追加；主循环、HUD、战斗、AI、关卡、音频全部走原路径。
2. 伤害（26）与射速（720 RPM）是 `dm()` 闭包常量，无法在不改原码的前提下按配置区分——三套配置的差异面为：弹容/备弹/散布/涂装/配件/名称（散布在每帧 `ve.spread` 重写后按系数收敛）。
3. 体积雾的环境项每帧读取模块常量 `en.fog`（闭包内不可达），夜晚主题下体积雾色保持黄昏基调——天空/太阳/曝光/直射光已随主题切换。
4. 配件几何用关卡中的 `BoxGeometry` 反查构造器生成（与原作积木式程序化美术同风格），网格挂到原版视图模型层（layer 1）。
5. 按键仅在 `t.game.state === "playing"` 时生效；`1/2/3/T/O/N` 均未占用原版键位（`h_` 映射表核对过）。
6. 控制器透传字段清单：`ammo/magSize/reserve/name/spread/state/ads/root/info/debug/damage/rpm`，方法透传 `update/setVisible/setWetness/muzzleWorld/snap/reload/reset`。

## 五、验证（headless Edge 实测）

| 项 | 结果 |
|---|---|
| 装载 | `__ready` + `[slx] ready`，0 pageerror |
| 切配置 | 1/2/3：名称、弹容、备弹、弹药即时生效；SD 消音器可见；切换后枪身恢复显示 |
| HUD | `PAC-9 SD` / `PAC-9 DMR`、弹匣排 45/15、备弹 150/060 全部跟随（截图确认） |
| 主题 | 黄昏(0.055/9/1.0) → 白天(0.280/11.5/1.06) → 夜晚(0.008/2.2/0.82)，天空/太阳/曝光实测生效（截图确认） |
| 准星 | `KeyO` 后覆盖规则 `#slx-style` 更新 ✓ |
| 视觉截图 | `shot_dusk_std.png`、`shot_dusk_sd.png`、`shot_day_dmr.png`、`shot_night_sd.png` |

## 六、重新注入（slx.js 改动后）

```bash
node -e "
const fs=require('fs');
const html=fs.readFileSync('index.html','utf8');
const slx=fs.readFileSync('slx.js','utf8');
const start=html.indexOf('/* =====================================================================\n * SALTLINE EXTENSION MODULE');
const end=html.indexOf('</script>', start);
fs.writeFileSync('index.html', html.slice(0,start)+slx+html.slice(end));
"
```

冒烟脚本：`tidebreak_project/tools/p_saltline_smoke.mjs`、`p_saltline_shot.mjs`（需在 tidebreak_project/tools 下运行以复用其 node_modules）。

---

## 七、SLX v1.1 补全（2026-11-13，自检缺失项落地）

| # | 缺失项 | 实现 | 位置（slx.js） |
|---|---|---|---|
| 1 | 武器伤害差异 | 包装 `t.combat.playerShot`（武器每发经 `i.combat` 活引用调用），按配置缩放伤害：标准 ×1 / SD ×0.85 / DMR ×1.6；弱点 ×2.2 保持原版逻辑 | `1b)` 节 |
| 2 | 伤害飘字 | 命中点经相机投影到屏幕 DOM，弱点亮橙 / 击杀红色 / 普通米白，0.7s 上飘淡出；上限 24 条 | `showDamage()` + `#slx-dmg` 层 |
| 3 | 击杀信息流 | 右上角滚动列表（最近 5 条，3.8s 自动过期），样式复用原版 `--plate-solid/--line/--f-mono` 变量 | `feedAdd()` |
| 4 | 战绩存档 | 轮询 `t.game.state` 识别出击/通关/阵亡转移点；通关数据读结算屏 `data-f` DOM（时间/评级/击毁/重试）；持久化到 `saltline.ext.v1`；标题屏注入"战绩"行 | `recordsText()/updateRecordsLine()` + 轮询 |
| 5 | F3 调试面板 | FPS（自计数）/ 绘制调用与三角形（`t.render.stats()`）/ 游戏状态 / 玩家坐标 | `toggleDebug()` + F3 键 |
| 6 | 配件几何回退 | 关卡无 BoxGeometry 时克隆枪身最小网格几何并缩放成型（原为占位符 `BoxGeoC = MeshC && null` 直接放弃配件） | 配件网格构建段 |
| 7 | 调试/验证出口 | `window.SLX = {version, records, showDamage, feedAdd, toggleDebug, updateRecordsLine}`（与原版 `__G/__stats` 出口同一思路） | 模块尾部 |

- 仍未实现（有意deferred）：运行时多语言切换（汉化为源级替换，需整体重构为字符串表）；色弱/字幕选项。
- 验证：headless 实测 `playerShot.__slx===1`、飘字 "36"（rgb(255,179,71)）渲染于准星上方、信息流两条、F3 面板 FPS 58/DRAW 318、战绩行与 localStorage 持久化；0 pageerror。
- 截图：`v11_feed_damage.png`、`v11_damage2.png`。

---

## 八、SLX v1.2 TIDEBREAK 特性移植（2026-11-13）

| 来源（TIDEBREAK） | 移植实现 | 说明 |
|---|---|---|
| **地图维度**（3 图 + 地图重建 + 指纹锁） | **布局加载系统**（KeyM 循环 + `?seed=` 直达）：原版 boot 原生支持 `?seed=` 播种关卡随机数（`rng:il(+(i.seed||4207))`），切换 seed = 不同集装箱堆叠布局；记忆到 localStorage，URL 无 seed 时自动应用一次 | 受原版单关卡生成器限制，不做"三张完全不同场景"（那需要重写 level 模块）；seed 布局变体为架构兼容的最优解 |
| **攻击机制**（手雷投掷 throwT + 范围伤害） | **手雷投掷**（G 键，每次出击 3 枚）：弹道积分 + `physics.raycast` 碰撞起爆（落地弹跳衰减，速度 <1.5 或引信 2.2s 触发）；`fx.explosion(pos,1.6)` 视听 + 遍历 `enemies.list` 按 7m 半径衰减伤害（110 → 0），击杀走原版事件流 → 信息流播报；屏幕震动 `player.addShake(0.6)`；支持多枚并发 | 每次出击自动补满；阵亡/重开重置 |
| **联机**（服务端 + WS 同步） | **未移植**：需将玩家/战斗/敌人三模块网络化重写（服务端权威 + 远端角色渲染），与"原结构兼容"约束冲突 | 已出评估：可做但属独立项目规模；如需要建议作为 saltline-ext v2 单独立项 |
| 武器维度补充 | TIDEBREAK 18 武器库依赖各自程序化建模，PAC-9 单枪模型无法承载；SLX 以"属性配置 + 涂装/配件"表达（v1.1 已做） | — |

**v1.2 新增按键**：`G` 手雷 · `M` 布局循环（`?seed=` 直达任意布局）
**验证**：手雷存量 2→1→0（第 4 次正确拒绝）、多枚并发、爆炸后场景清理（15→16→15）、布局重载 `?seed=31337` 生效、0 pageerror。
