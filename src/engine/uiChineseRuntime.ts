import { HandTracker } from './handTracking';
import { VfxRenderer } from './renderer';

const TEXT: Record<string, string> = {
  'VECTOR KEYFRAME': '矢量关键帧',
  'Camera frames stay local': '摄像头画面仅在本机处理',
  'REALTIME GESTURE VFX': '实时手势视觉特效',
  'Grab the visual world': '用双手操控视觉世界',
  'with your hand.': '实时抓取、移动与变形。',
  'Browser camera + hand landmarks + GPU vector masking. Pinch a portal, move it through space, distort the edge with velocity, then record the final composite.': '浏览器摄像头 + 手部关键点 + GPU 矢量蒙版。捏合抓取传送门，移动、变形并用速度驱动边缘特效，最后直接录制合成画面。',
  'Enter Studio': '进入工作室',
  'Pinch to grab': '捏合抓取',
  'Move to morph': '移动变形',
  'Record canvas': '录制画面',
  'PINCH / DRAG': '捏合 / 拖动',
  'WEBGL2 / MEDIAPIPE / LOCAL-FIRST': 'WEBGL2 / MEDIAPIPE / 本地优先',
  'v0.5 MULTI-MASK SCENE': '多蒙版实时场景',

  'Starting camera…': '正在启动摄像头…',
  'Requesting camera access…': '正在请求摄像头权限…',
  'Camera ready': '摄像头已就绪',
  'Camera permission was denied. Enable camera access and reload the Studio.': '摄像头权限被拒绝。请允许摄像头访问后重新打开工作室。',
  'Unable to open the camera. It may be unavailable or in use by another app.': '无法打开摄像头。设备可能不可用，或正被其他应用占用。',
  'WebGL2 initialization failed.': 'WebGL2 初始化失败。',
  'LOCAL CAMERA': '本地摄像头',
  'Camera / renderer unavailable': '摄像头 / 渲染器不可用',
  'Try again': '重试',
  'Show your hand': '把手放到画面中',
  'Pinch thumb + index finger': '拇指与食指捏合',
  'Move your hand': '移动你的手',
  'Release': '松开手指',
  'Gesture control ready': '手势控制已就绪',
  'Hand tracking active': '手部追踪已启用',
  'Loading hand model…': '正在加载手部模型…',
  'LIVE CONTROL': '实时控制',
  'Mask': '蒙版',
  'Effects': '特效',
  'Gesture + Motion': '手势与运动',
  'Motion': '运动',
  'Record': '录制',
  'Settings': '设置',
  'Controls': '控制面板',

  'EFFECT MODE · CAROUSEL': '特效模式 · 自动轮播',
  'Auto carousel': '自动轮播',
  'Carousel interval (ms)': '轮播间隔（毫秒）',
  'PRESET TRANSITION': '预设转场',
  'Transition duration (ms)': '转场时长（毫秒）',
  'Alternate world': '替代画面',
  'No alternate media': '未选择替代素材',
  'Re-select alternate media': '请重新选择替代素材',
  'RGB split amount': 'RGB 分离强度',
  'Ripple amount': '波纹强度',
  'Pixelate cells': '像素化网格',
  'Distortion amount': '扭曲强度',
  'Edge glow': '边缘辉光',
  'TEMPORAL FX': '时间特效',
  'History delay (ms)': '历史延迟（毫秒）',
  'Temporal mix': '时间混合',
  'Invert mask': '反转蒙版',
  'Manual preset changes, swipe changes and Carousel all snapshot the previous processed GPU texture first. The selected transition is rendered into the final canvas, so recordings include it.': '手动切换预设、滑动切换和自动轮播都会先保存上一帧已处理的 GPU 纹理，再执行转场；最终录制会包含这些转场效果。',

  'circle': '圆形',
  'blob': '流体',
  'portal': '传送门',
  'trail': '轨迹',
  'custom': '自定义',
  'TRAIL RELEASE': '轨迹释放方式',
  'hold': '保持',
  'dissipate': '消散',
  'close': '闭合',
  'expand': '扩张',
  'burst': '爆裂',
  'shrink': '收缩',
  'Raw trail points': '原始轨迹点',
  'Reset transform': '重置变换',
  'Vector Trail is smoothed before rendering. Release behavior can hold the crack, dissipate it, close from both ends, expand, burst outward, or shrink its width to zero.': '矢量轨迹会在渲染前进行平滑。松手后可保持、消散、从两端闭合、扩张、向外爆裂或逐渐收缩到零。',

  'State': '状态',
  'Hands': '手数量',
  'Pinch ratio': '捏合比例',
  'Hand speed': '手部速度',
  'History buffer': '历史缓冲',
  'MOTION KEYFRAMES': '运动关键帧',
  'Record motion': '录制运动',
  'Stop motion capture': '停止运动采集',
  'Keyframes': '关键帧',
  'Duration': '时长',
  'Playback': '回放',
  'stopped': '已停止',
  'Once': '单次',
  'Loop': '循环',
  'Reverse': '反向',
  'Ping Pong': '往返',
  'Stop playback': '停止回放',
  'Clear motion': '清空运动',
  'Motion capture automatically creates sparse keyframes from transform, effect-stack, gesture-state and interaction-point changes. Scrubbing evaluates the same interpolation path as playback; Vector Slash reconstructs its crack up to the selected time.': '运动采集会根据变换、特效栈、手势状态和交互点变化自动生成稀疏关键帧。拖动时间轴与正式回放使用同一套插值路径；矢量切割会重建到所选时间点为止的轨迹。',

  'Start video recording': '开始视频录制',
  'Stop recording': '停止录制',
  'Save WebM': '保存 WebM',
  'Video recording captures only the final WebGL canvas: camera + historical/alternate layers + ordered effect passes + transitions + mask + edge VFX. Studio UI and debug overlays are excluded.': '视频录制只保存最终 WebGL 画面：摄像头、历史/替代图层、有序特效、转场、蒙版和边缘特效；工作室 UI 与调试叠层不会录入。',
  'Mirror front camera': '镜像摄像头（固定开启）',
  'Render scale': '渲染比例',
  'Render FPS': '渲染帧率',
  'Tracking FPS': '追踪帧率',
  'Temporal history': '时间历史',
  'Tracking debug': '追踪调试',

  'RENDER': '渲染',
  'TRACK': '追踪',
  'STATE': '状态',
  'PINCH': '捏合',
  'VELOCITY': '速度',
  'HISTORY': '历史',
  'TRAIL': '轨迹',
  'MASK': '蒙版',

  'Multiverse Portal': '多元宇宙传送门',
  'Cyber Reality': '赛博现实',
  'Dream Window': '梦境窗口',
  'Time Window': '时间窗口',
  'Freeze World': '冻结世界',
  'Vector Slash': '矢量切割',
  'Cross Fade': '交叉淡化',
  'Wipe': '方向擦除',
  'Glitch': '故障闪烁',
  'Flash': '闪光',
  'Liquid': '液态转场',
  'None': '无',
  'Echo': '回声',
  'After Image': '残影',

  'EFFECT STACK · GPU ORDER': '特效栈 · GPU 顺序',
  'Top → bottom': '从上到下',
  'RGB Split': 'RGB 分离',
  'Ripple': '波纹',
  'Pixelate': '像素化',
  'Distortion': '扭曲',
  'Selected node': '当前节点',
  'Node intensity': '节点强度',
  'Node opacity': '节点透明度',
  'BLEND MODE': '混合模式',
  'normal': '正常',
  'add': '相加',
  'screen': '滤色',
  'multiply': '正片叠底',
  'EDGE FX · STANDALONE PASS': '边缘特效 · 独立渲染通道',
  'Off': '关闭',
  'Neon': '霓虹',
  'Scanner': '扫描',
  'Electric': '电流',
  'Particle': '粒子',
  'Edge speed': '边缘速度',
  'Edge density': '边缘密度',
  'Ordered effect rows run before masking. Edge FX is a separate final WebGL pass on the same recordable canvas, so changing Neon / Scanner / Electric / Particle does not reorder or contaminate the texture effect graph.': '有序特效栈先于蒙版执行；边缘特效使用同一可录制画布上的独立最终 WebGL 通道，因此切换霓虹、扫描、电流或粒子不会改变纹理特效图的顺序。',

  'PROJECT JSON': '项目 JSON',
  'Export project': '导出项目',
  'Import project': '导入项目',
  '.json · validated locally': '.json · 本地校验',
  'Project JSON stores single-mask state, Multi-Mask Scene Graph, per-mask Effect Stacks, Temporal FX, Carousel/transition settings, Motion Track and Scene Motion lanes. Uploaded image/video bytes stay local and are never embedded in the JSON.': '项目 JSON 保存单蒙版状态、多蒙版场景图、各蒙版特效栈、时间特效、轮播/转场设置、运动轨道和场景运动轨道。上传的图片和视频文件始终保留在本机，不会嵌入 JSON。',

  'KEYFRAME TIMELINE': '关键帧时间轴',
  'Record a motion performance to generate the first timeline.': '先录制一段运动，系统会生成第一条关键帧时间轴。',
  'PLAYING': '播放中',
  'SCRUB READY': '可拖动预览',

  'Multi-Mask Scene': '多蒙版场景',
  'Single-mask mode': '单蒙版模式',
  'Add': '添加',
  'SELECTED MASK': '当前蒙版',
  'Trail locked': '轨迹已锁定',
  'Pinch draws · two hands transform': '单手捏合绘制 · 双手变换',
  'Gesture transform locked': '手势变换已锁定',
  'Pinch controls this node': '捏合控制当前节点',
  'Effect preset · live crossfade': '特效预设 · 实时渐变',
  'Preset transition': '预设转场时长',
  'Transition easing': '转场缓动',
  'Linear': '线性',
  'Ease In': '缓入',
  'Ease Out': '缓出',
  'Ease In-Out': '缓入缓出',
  'VECTOR TRAIL PATH': '矢量轨迹路径',
  'Single-hand Pinch redraws': '单手捏合重新绘制',
  'Clear trail path': '清空轨迹路径',
  'The path is stored in node-local coordinates. Draw with one pinching hand; use two pinching hands to move, scale or rotate the completed Trail as one Scene node.': '路径以节点局部坐标保存。单手捏合绘制；完成后用双手捏合可将整个轨迹节点移动、缩放或旋转。',
  'Expansion': '扩张',
  'Feather': '羽化',
  'Scene order runs from bottom to top. Circle / Blob / Portal / Custom / Trail nodes all participate in the same GPU Scene, Motion lanes, Effect Sequence and recording pipeline. Preset crossfades run independently per mask.': '场景顺序从下到上。圆形、流体、传送门、自定义和轨迹节点共享同一套 GPU 场景、运动轨道、特效序列和录制管线；每个蒙版的预设渐变可独立运行。',

  'SCENE MOTION': '场景运动',
  'Capturing multi-mask lanes': '正在采集多蒙版轨道',
  'Editable identity-preserving keyframes': '可编辑、保持节点身份的关键帧',
  'No track': '暂无轨道',
  'Record Scene Motion': '录制场景运动',
  'Stop Capture': '停止采集',
  'Progress': '进度',
  'Playback range': '回放范围',
  'BOUNDARY': '边界关键帧',
  'EDITABLE': '可编辑',
  'Segment easing': '片段缓动',
  'Key time': '关键帧时间',
  'Update from current scene': '从当前场景更新',
  'Delete key': '删除关键帧',
  'Clear track': '清空轨道',
  'Select a key to edit it. Interior keys can be dragged horizontally to retime them; boundary keys keep the lane duration stable. Easing belongs to the segment leaving a key, and In/Out limits are respected by Once, Loop, Reverse and Ping Pong playback.': '选择关键帧即可编辑。中间关键帧可水平拖动调整时间，边界关键帧用于保持轨道时长稳定。缓动作用于从当前关键帧出发的片段，入点/出点范围会同时约束单次、循环、反向和往返回放。',

  'EFFECT SEQUENCE': '特效序列',
  'Time-ranged per-mask effect clips': '按时间范围作用于各蒙版的特效片段',
  'Record a Scene Motion track first. Effect Sequence uses that timeline as its absolute clock and never rewrites motion keyframes.': '请先录制场景运动轨道。特效序列使用该时间轴作为绝对时钟，不会改写运动关键帧。',
  'Preview time': '预览时间',
  'Add clip at playhead': '在播放头处添加片段',
  'Preset': '预设',
  'Start': '开始',
  'End': '结束',
  'Fade in': '淡入',
  'Fade out': '淡出',
  'Intensity': '强度',
  'Drag a clip body to move it and drag either edge to resize it. Sliders remain available for precise values. Clips are evaluated in list order and modify only render-time Effect/Temporal/Edge settings; Transform, geometry and Scene Motion keys are untouched.': '拖动片段主体可移动时间位置，拖动两侧可调整长度；滑块可用于精确数值。片段按列表顺序执行，只修改渲染时的特效、时间和边缘设置，不改变变换、几何形状和场景运动关键帧。',

  'VECTOR MASK EDITOR': '矢量蒙版编辑器',
  'Draw a closed silhouette': '绘制闭合轮廓',
  'Closed cubic Bezier': '闭合三次贝塞尔曲线',
  'Draw': '绘制',
  'Delete': '删除',
  'Linked': '联动',
  'Free': '自由',
  'Reset': '重置',
  'Use Draw for a fast silhouette: the stroke is resampled into a small editable cubic curve. Then drag anchors or handles for precise cleanup. Linked handles stay tangent; Free handles allow asymmetric corners.': '使用“绘制”可快速勾勒轮廓，笔迹会被重采样成少量可编辑的三次贝塞尔曲线。随后拖动锚点或手柄进行精修；联动手柄保持切线，自由手柄允许不对称拐角。',

  'GPU PROFILER': 'GPU 性能分析',
  'GPU N/A': 'GPU 不可用',
  'REAL-DEVICE PROFILER': '真实设备性能分析',
  'Passes': '通道数',
  'Scale': '比例',
  'warming': '预热中',
  'unsupported': '不支持',
  'GPU timer reported a disjoint interval. Those timing samples are discarded.': 'GPU 计时器报告了不连续区间，该批计时样本已丢弃。',
  'MASKS': '蒙版数',
  'Collecting samples… Keep a scene running for a few seconds, then try 1 / 2 / 3 / 4 visible masks.': '正在采集样本… 让场景运行几秒，然后依次测试 1 / 2 / 3 / 4 个可见蒙版。',
  'Reset samples': '重置样本',
  'Export JSON': '导出 JSON',
  'Samples are collected locally about four times per second and bucketed by visible mask count. GPU time uses `EXT_disjoint_timer_query_webgl2` only when the current browser exposes it; unsupported devices show N/A instead of an estimated value.': '样本仅在本机采集，每秒约四次，并按可见蒙版数量分组。只有浏览器支持 `EXT_disjoint_timer_query_webgl2` 时才记录 GPU 时间；不支持的设备显示不可用，不进行估算。',

  'Camera is ready but paused': '摄像头已就绪但已暂停',
  'Tap to resume the live preview': '点击恢复实时预览',
  'Camera connected': '摄像头已连接',
  'Waiting for the first real camera frame…': '正在等待第一帧真实摄像头画面…',
  'Live camera fallback': '实时摄像头降级模式',
  'GPU output is invalid · showing raw camera instead': 'GPU 输出异常 · 已切换为原始摄像头',
  'RAW CAMERA': '原始摄像头',
  'GPU bypassed · tap for VFX auto': '已绕过 GPU · 点击恢复自动特效',
  'VFX AUTO': '特效自动',
  'tap to force raw camera': '点击强制显示原始摄像头',
  'No decoded frames yet · applying a 720p / 30fps recovery profile…': '尚未收到解码画面 · 正在尝试 720p / 30fps 恢复模式…',
  'Camera is active but frames are not arriving. Try switching camera or reloading the Studio.': '摄像头处于活动状态，但没有收到画面。请尝试切换摄像头或重新打开工作室。',
  'Camera is active but no decoded frames are arriving. Try switching camera or reloading the Studio.': '摄像头处于活动状态，但没有收到解码帧。请尝试切换摄像头或重新打开工作室。',
  'WebGL2 context is unavailable or lost': 'WebGL2 上下文不可用或已丢失',
};

const ATTRS = ['title', 'aria-label', 'placeholder'] as const;

const ATTR_TEXT: Record<string, string> = {
  'Exit studio': '退出工作室',
  'Mirror camera': '镜像已固定开启',
  'Switch camera': '切换摄像头',
  'Debug HUD': '调试信息',
  'Studio controls': '工作室控制',
  'Start recording': '开始录制',
  'Stop recording': '停止录制',
  'Edit this effect node': '编辑此特效节点',
  'Disable effect': '关闭特效',
  'Enable effect': '启用特效',
  'Move up': '上移',
  'Move down': '下移',
  'Hide mask': '隐藏蒙版',
  'Show mask': '显示蒙版',
  'Unlock gesture transform': '解锁手势变换',
  'Lock gesture transform': '锁定手势变换',
  'Delete mask': '删除蒙版',
  'Scrub motion timeline': '拖动运动时间轴',
  'Disable clip': '关闭片段',
  'Enable clip': '启用片段',
  'Clip name': '片段名称',
  'Move earlier in overlay order': '在叠加顺序中提前',
  'Move later in overlay order': '在叠加顺序中后移',
  'Delete clip': '删除片段',
};

function translateDynamic(value: string) {
  let match = value.match(/^(\d+) masks · GPU scene active$/);
  if (match) return `${match[1]} 个蒙版 · GPU 场景已启用`;
  match = value.match(/^(\d+) mask(?:s)? · (\d+) passes$/);
  if (match) return `${match[1]} 个蒙版 · ${match[2]} 个渲染通道`;
  match = value.match(/^(\d+) keys · (.+)$/);
  if (match) return `${match[1]} 个关键帧 · ${match[2]}`;
  match = value.match(/^(\d+) lanes · (\d+) keys$/);
  if (match) return `${match[1]} 条轨道 · ${match[2]} 个关键帧`;
  match = value.match(/^(\d+) anchors$/);
  if (match) return `${match[1]} 个锚点`;
  match = value.match(/^(\d+) local points$/);
  if (match) return `${match[1]} 个局部点`;
  match = value.match(/^(\d+)\/32 clips$/);
  if (match) return `${match[1]}/32 个片段`;
  match = value.match(/^Key (\d+) · (.+)$/);
  if (match) return `关键帧 ${match[1]} · ${match[2]}`;
  match = value.match(/^Playing · (.+)$/);
  if (match) return `播放中 · ${TEXT[match[1]] ?? match[1]}`;
  match = value.match(/^Project exported · (\d+) motion keyframes$/);
  if (match) return `项目已导出 · ${match[1]} 个运动关键帧`;
  match = value.match(/^Loaded (.+)\. Project restored; choose the alternate image\/video again\.$/);
  if (match) return `已载入 ${match[1]}。项目已恢复；请重新选择替代图片/视频。`;
  match = value.match(/^Loaded (.+)\. Project state and motion track restored\.$/);
  if (match) return `已载入 ${match[1]}。项目状态和运动轨道已恢复。`;
  match = value.match(/^Import failed: (.+)$/);
  if (match) return `导入失败：${match[1]}`;
  match = value.match(/^Preview keyframe (\d+) at (.+)$/);
  if (match) return `预览第 ${match[1]} 个关键帧，时间 ${match[2]}`;
  match = value.match(/^VFX canvas produced a black frame while the camera contains image data(.+)$/);
  if (match) return `特效画布输出黑帧，但摄像头存在有效画面${match[1]}`;
  return value;
}

function translateValue(value: string) {
  return TEXT[value] ?? ATTR_TEXT[value] ?? translateDynamic(value);
}

function replacePreservingWhitespace(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return value;
  const translated = translateValue(trimmed);
  if (translated === trimmed) return value;
  const start = value.slice(0, value.indexOf(trimmed));
  const end = value.slice(value.indexOf(trimmed) + trimmed.length);
  return `${start}${translated}${end}`;
}

function translateNode(node: Node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const parent = node.parentElement;
    if (!parent || ['SCRIPT', 'STYLE', 'TEXTAREA'].includes(parent.tagName)) return;
    const next = replacePreservingWhitespace(node.nodeValue ?? '');
    if (next !== node.nodeValue) node.nodeValue = next;
    return;
  }
  if (!(node instanceof Element)) return;
  for (const attr of ATTRS) {
    const value = node.getAttribute(attr);
    if (!value) continue;
    const next = translateValue(value);
    if (next !== value) node.setAttribute(attr, next);
  }
  node.childNodes.forEach(translateNode);
}

function enforceMirrorControls() {
  document.querySelectorAll<HTMLButtonElement>('button[title="Mirror camera"], button[title="镜像已固定开启"]').forEach((button) => {
    button.disabled = true;
    button.title = '镜像已固定开启';
    button.setAttribute('aria-label', '镜像已固定开启');
  });
  document.querySelectorAll<HTMLLabelElement>('.toggle-row').forEach((label) => {
    if (!label.textContent?.includes('镜像摄像头')) return;
    const input = label.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!input) return;
    input.checked = true;
    input.disabled = true;
  });
}

let installed = false;

export function installChineseUiRuntime() {
  if (installed) return;
  installed = true;

  document.documentElement.lang = 'zh-CN';
  document.title = '矢量关键帧 — 实时手势视觉特效';

  const rendererSetMirror = VfxRenderer.prototype.setMirror;
  VfxRenderer.prototype.setMirror = function setMirrorAlwaysOn() {
    return rendererSetMirror.call(this, true);
  };

  const trackerSetMirrored = HandTracker.prototype.setMirrored;
  HandTracker.prototype.setMirrored = function setTrackingMirrorAlwaysOn() {
    return trackerSetMirrored.call(this, true);
  };

  const refresh = (node: Node = document.body) => {
    translateNode(node);
    enforceMirrorControls();
  };

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') translateNode(mutation.target);
      if (mutation.type === 'attributes') translateNode(mutation.target);
      mutation.addedNodes.forEach(translateNode);
    }
    enforceMirrorControls();
  });

  if (document.body) {
    refresh();
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...ATTRS],
    });
  } else {
    window.addEventListener('DOMContentLoaded', () => {
      refresh();
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: [...ATTRS],
      });
    }, { once: true });
  }
}
