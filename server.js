// 超幸運ロシアンパーティ リアルタイム対戦サーバー（スマホ配布用・単一ファイル版）
// 画面HTMLもこのファイルに含まれているので、フォルダなしでアップロードできる
//
// ================= ルール要約（CARD_SPEC.md が正） =================
// ・4〜8人対戦。残機3。ラウンド制（残り1人でラウンド終了、次ラウンドは全員に配り直し、残機は引き継ぐ）
// ・配布: 実弾×1＋裏取引×1（全員確定）＋共通山札56枚からランダム5枚 = 7枚
// ・7枚から実弾を含む6枚を好きな順番でリボルバーに装填。余り1枚は廃棄
// ・自分の手番に先頭の弾を発砲（公開）し、カード効果を解決する
// ・実弾を公開すると残機−1＆そのラウンド退場。誰かの残機が0になったラウンドが
//   最終ラウンドとなり、そのラウンドを最後まで（残り1人まで）行ってからゲーム終了、残機最多が優勝
// ・フィールド効果（圧倒的なパワー／私がルール）はラウンド中持続。発動中は画面全体の色調が変わり、上部にバッジが出る
// ・ラウンド終了時は勝者と「全弾を無事に撃ち切ったプレイヤー」を表彰表示する（発砲数・完走は公開情報のみで追跡）
// ・全プレイヤーの弾に持ち主の印（プレイヤー色＋名前の頭文字）が付き、誰の弾か全員に分かる（2026-11-19変更）。中身は公開されるまで本人にも分からない
// ・切断したプレイヤーの再接続は未対応（ロビー以外では席とカードは保持される）
// ==================================================================
const http = require('http');
const { Server } = require('socket.io');

// ===== 設定 =====
const CONFIG = {
  minPlayers: 4,     // ゲーム開始に必要な人数
  maxPlayers: 8,     // プレイヤー上限（以降は観戦者）
  initialLives: 3,   // 残機の初期値（ラウンドをまたいで引き継ぐ）
  handSize: 7,       // 1人に配る枚数
  setSize: 6,        // リボルバーに装填する枚数（実弾を必ず含む）
  maxSaiminDepth: 3, // 催眠の入れ子の深さ上限
};
// 発砲アニメーションの種別ホワイトリスト。
// 本人のクライアントが抽選した種別を 'fire' リクエストで受け取り、
// 'shot' イベントに載せて全員へ配信する（各画面の見た目だけに使い、
// ゲームロジック・解決結果には一切影響しない。不正値は 'normal' に丸める）
const ANIM_TYPES = new Set(['normal', 'heavy', 'again', 'slow', 'gold']);
function validAnim(a) { return ANIM_TYPES.has(a) ? a : 'normal'; }
// 山札構成（合計56枚・重複なしの実物デッキ）
const DECK = {
  amanojaku: 5,  // 天邪鬼
  kurayami: 3,   // 暗闇
  unmei: 2,      // 運命
  reverse: 5,    // リバース
  mosaic: 3,     // ランダムモザイク
  takara: 2,     // 宝の持ち腐れ
  usagi: 5,      // ウサギ跳び
  saimin: 5,     // 催眠
  fujimi: 4,     // 不死身
  damazumari: 5, // 弾詰まり
  hengen: 2,     // 変幻
  ubaiai: 5,     // 奪い合い
  uchikeshi: 3,  // 打ち消し
  nusumimi: 5,   // 盗み見
  power: 1,      // 圧倒的なパワー
  rule: 1,       // 私がルール
};
const CARD_TYPES = {
  live: { label: '実弾' },
  deal: { label: '裏取引' },
  amanojaku: { label: '天邪鬼' },
  kurayami: { label: '暗闇' },
  unmei: { label: '運命' },
  reverse: { label: 'リバース' },
  mosaic: { label: 'ランダムモザイク' },
  takara: { label: '宝の持ち腐れ' },
  usagi: { label: 'ウサギ跳び' },
  saimin: { label: '催眠' },
  fujimi: { label: '不死身' },
  damazumari: { label: '弾詰まり' },
  hengen: { label: '変幻' },
  ubaiai: { label: '奪い合い' },
  uchikeshi: { label: '打ち消し' },
  nusumimi: { label: '盗み見' },
  power: { label: '圧倒的なパワー' },
  rule: { label: '私がルール' },
};
const label = (t) => (CARD_TYPES[t] ? CARD_TYPES[t].label : t);

const HTML = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>超幸運ロシアンパーティ - リアルタイム対戦</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, "Hiragino Sans", sans-serif; margin: 0; padding: 14px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
  h1 { font-size: 22px; margin: 4px 0; }
  .card { width: min(94vw, 560px); border: 1px solid #8884; border-radius: 12px; padding: 14px; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  button { font-size: 16px; padding: 10px 14px; border-radius: 10px; border: 1px solid #8886; cursor: pointer; }
  button.primary { background: #b02a30; color: #fff; border-color: #b02a30; }
  button:disabled { opacity: .45; cursor: not-allowed; }
  button.pick { border-width: 2px; }
  button.pick.sel { outline: 3px solid #f5c542; outline-offset: 1px; }
  input { font-size: 16px; padding: 10px; border-radius: 10px; border: 1px solid #8888; }
  input.code { width: 120px; text-transform: uppercase; letter-spacing: 2px; }
  input.name { width: 180px; }
  .big { font-size: 18px; font-weight: 600; }
  .muted { opacity: .75; font-size: 14px; }
  #msg { min-height: 1.4em; color: #c0392b; }
  .plist { list-style: none; margin: 8px 0; padding: 0; }
  .plist li { padding: 6px 8px; border-bottom: 1px solid #8883; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .badge { font-size: 12px; padding: 2px 7px; border-radius: 999px; border: 1px solid #8887; }
  .badge.host { background: #f5c54233; }
  .badge.out { background: #b02a3033; }
  .badge.ready { background: #2a7d4f33; }
  .badge.fx { background: #5a4fcf33; }
  .hearts { color: #d6336c; letter-spacing: 1px; }
  /* 弾薬（カートリッジ） */
  .hand { display: flex; gap: 8px; flex-wrap: wrap; margin: 10px 0; }
  .hcard { width: 76px; min-height: 104px; border-radius: 10px; border: 2px solid #8887; background: linear-gradient(to top, #d9a441 0 12px, #0000 12px), #fff1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 6px 4px 16px; font-size: 15px; font-weight: 600; position: relative; cursor: pointer; text-align: center; }
  .hcard .sub { font-size: 11px; font-weight: 400; opacity: .75; }
  .hcard.sel { outline: 3px solid #f5c542; outline-offset: 1px; }
  .hcard .ord { position: absolute; top: -8px; right: -8px; background: #f5c542; color: #000; border-radius: 50%; width: 24px; height: 24px; line-height: 24px; font-size: 14px; }
  .hcard.live { border-color: #b02a30; } .hcard.deal { border-color: #6f42c1; }
  .hcard.amanojaku { border-color: #0e7c86; } .hcard.kurayami { border-color: #343a40; }
  .hcard.unmei { border-color: #c2185b; } .hcard.reverse { border-color: #2a7d4f; }
  .hcard.mosaic { border-color: #8d6e00; } .hcard.takara { border-color: #b8860b; }
  .hcard.usagi { border-color: #e5989b; } .hcard.saimin { border-color: #5a4fcf; }
  .hcard.fujimi { border-color: #2e8b57; } .hcard.damazumari { border-color: #795548; }
  .hcard.hengen { border-color: #7b2d8b; } .hcard.ubaiai { border-color: #c05621; }
  .hcard.uchikeshi { border-color: #4a6fa5; } .hcard.nusumimi { border-color: #607d8b; }
  .hcard.power { border-color: #e64a19; } .hcard.rule { border-color: #283593; }
  /* シリンダー */
  .cyl-bg { fill: #1d1d26; stroke: #555; stroke-width: 1.5; }
  .cyl-center { fill: #3a3a48; stroke: #666; }
  .ch { stroke: #888; stroke-width: 1.2; }
  .ch-empty { fill: #26262f; }
  .ch-loaded { fill: #45455a; }
  .ch-next { stroke: #ff9800; stroke-width: 3.2; }
  .ch-set-live, .ch-open-live { fill: #b02a30; } .ch-set-deal, .ch-open-deal { fill: #6f42c1; }
  .ch-set-amanojaku, .ch-open-amanojaku { fill: #0e7c86; } .ch-set-kurayami, .ch-open-kurayami { fill: #343a40; }
  .ch-set-unmei, .ch-open-unmei { fill: #c2185b; } .ch-set-reverse, .ch-open-reverse { fill: #2a7d4f; }
  .ch-set-mosaic, .ch-open-mosaic { fill: #8d6e00; } .ch-set-takara, .ch-open-takara { fill: #b8860b; }
  .ch-set-usagi, .ch-open-usagi { fill: #e5989b; } .ch-set-saimin, .ch-open-saimin { fill: #5a4fcf; }
  .ch-set-fujimi, .ch-open-fujimi { fill: #2e8b57; } .ch-set-damazumari, .ch-open-damazumari { fill: #795548; }
  .ch-set-hengen, .ch-open-hengen { fill: #7b2d8b; } .ch-set-ubaiai, .ch-open-ubaiai { fill: #c05621; }
  .ch-set-uchikeshi, .ch-open-uchikeshi { fill: #4a6fa5; } .ch-set-nusumimi, .ch-open-nusumimi { fill: #607d8b; }
  .ch-set-power, .ch-open-power { fill: #e64a19; } .ch-set-rule, .ch-open-rule { fill: #283593; }
  .cht { font-size: 11px; font-weight: 700; fill: #fff; }
  .cht.dark { fill: #333; }
  .chnum { font-size: 8px; fill: #888; }
  .brass { fill: #d9a441; }
  .owninit { font-size: 6.5px; font-weight: 800; fill: #fff; }
  @keyframes cylspin { from { transform: rotate(0deg); } to { transform: rotate(60deg); } }
  .cylspin { animation: cylspin .45s ease-out; }
  @keyframes flashanim { 0% { opacity: .9; } 100% { opacity: 0; } }
  #flash { position: fixed; inset: 0; background: radial-gradient(circle, #fff6c9, #ff5722); opacity: 0; pointer-events: none; z-index: 50; }
  #flash.go { animation: flashanim .55s ease-out; }
  #shotBanner { min-height: 1.6em; font-size: 20px; font-weight: 700; text-align: center; }
  #shotBanner.bang { color: #b02a30; font-size: 26px; }
  #shotBanner.click { opacity: .8; font-size: 17px; }
  /* 場のプレイヤー表示 */
  .field { display: flex; flex-direction: column; gap: 12px; }
  .prow { border: 1px solid #8883; border-radius: 10px; padding: 8px 10px; display: flex; gap: 12px; align-items: center; }
  .prow.turn { border-color: #f5c542; box-shadow: 0 0 0 2px #f5c54266; }
  .prow .phead { display: flex; flex-direction: column; gap: 3px; }
  .prow .pmeta { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  #fireBtn { font-size: 22px; font-weight: 700; padding: 18px 22px; width: 100%; border-radius: 14px; }
  #log { list-style: none; margin: 0; padding: 0; font-size: 14px; max-height: 220px; overflow-y: auto; }
  #log li { padding: 4px 2px; border-bottom: 1px solid #8882; }
  .actbtns { display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0; }
  .slotline { font-size: 15px; margin: 4px 0; }
  /* 持ち主マーキング（色＋頭文字。全員に見える） */
  .pchip { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; color: #fff; font-size: 12px; font-weight: 800; margin-right: 5px; vertical-align: -5px; }
  .owntag { font-weight: 700; white-space: nowrap; }
  .owndot { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 50%; color: #fff; font-size: 10px; font-weight: 800; margin-right: 3px; vertical-align: -3px; }
  .hchip { position: relative; }
  .hchip .own { position: absolute; top: -6px; right: -6px; width: 15px; height: 15px; border-radius: 50%; color: #fff; font-size: 9px; font-weight: 800; display: inline-flex; align-items: center; justify-content: center; border: 1px solid #fff; }
  /* フィールド効果の可視化: 発動中は画面全体の色調が変わる */
  body { transition: background-color .6s ease; }
  body.fx-power { background-color: #fbe3d5; }
  body.fx-rule { background-color: #dde2fa; }
  body.fx-both { background: linear-gradient(135deg, #fbe3d5 0%, #f3d9e8 50%, #dde2fa 100%); background-attachment: fixed; }
  @media (prefers-color-scheme: dark) {
    body.fx-power { background-color: #40200f; }
    body.fx-rule { background-color: #171d42; }
    body.fx-both { background: linear-gradient(135deg, #40200f 0%, #33182b 50%, #171d42 100%); }
  }
  #fxBanner { width: min(94vw, 560px); display: none; gap: 8px; flex-wrap: wrap; align-items: center; justify-content: center; }
  #fxBanner.show { display: flex; }
  .fxchip { font-size: 16px; font-weight: 800; padding: 8px 14px; border-radius: 999px; color: #fff; box-shadow: 0 2px 8px #0003; }
  .fxchip.power { background: #e64a19; }
  .fxchip.rule { background: #283593; }
  .fxnote { width: 100%; text-align: center; font-size: 14px; font-weight: 700; }
  /* 最終ラウンドのバッジ */
  #finalBanner { width: min(94vw, 560px); display: none; text-align: center; }
  #finalBanner.show { display: block; }
  .finalchip { display: inline-block; font-size: 16px; font-weight: 900; padding: 9px 16px; border-radius: 999px; color: #fff; background: #b02a30; box-shadow: 0 2px 10px #b02a3066; }
  /* カードピクトグラム（インラインSVG・画像ファイル不使用） */
  .pic { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 7px; background: #8882; background: color-mix(in srgb, currentColor 12%, transparent); border: 1.5px solid #8886; border-color: color-mix(in srgb, currentColor 45%, transparent); vertical-align: middle; }
  .pic svg { width: 19px; height: 19px; }
  .pic.sm { width: 22px; height: 22px; border-radius: 6px; }
  .pic.sm svg { width: 16px; height: 16px; }
  .pic.mid { width: 40px; height: 40px; border-radius: 11px; }
  .pic.mid svg { width: 29px; height: 29px; }
  .pic.big { width: 84px; height: 84px; border-radius: 20px; background: #ffffff2b; border-color: #ffffff59; }
  .pic.big svg { width: 60px; height: 60px; }
  #shotBanner { display: flex; flex-direction: column; align-items: center; gap: 6px; }
  /* 使用済みの弾の履歴チップ */
  .hist { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 4px; }
  .hchip { display: inline-flex; flex-direction: column; align-items: center; gap: 1px; width: 48px; padding: 4px 1px 3px; border-radius: 9px; border: 1.5px solid #8886; border-color: color-mix(in srgb, currentColor 45%, transparent); background: #8881; background: color-mix(in srgb, currentColor 9%, transparent); }
  .hchip .hn { font-size: 8.5px; font-weight: 700; line-height: 1.25; text-align: center; color: #333; }
  @media (prefers-color-scheme: dark) { .hchip .hn { color: #eee; } }
  .hchip .ord { font-size: 8px; opacity: .65; color: #333; }
  @media (prefers-color-scheme: dark) { .hchip .ord { color: #eee; } }
  .actbtns button { display: inline-flex; align-items: center; gap: 6px; }
  /* ===== 自分の手番の引き金アニメーション（サンプル確定版を移植。弾倉スピンは不採用） ===== */
  .tg-stage { --tg-gun: #3c414d; --tg-gun2: #23252d; --tg-wood: #8a5a33; position: relative; overflow: hidden; border-radius: 12px; border: 1px solid #8884; background: linear-gradient(180deg, #8881, #0000); padding: 6px 4px 2px; margin-bottom: 8px; transition: box-shadow .5s ease; }
  @media (prefers-color-scheme: dark) { .tg-stage { --tg-gun: #565d6e; --tg-gun2: #33363f; --tg-wood: #a06a3a; } }
  .tg-stage svg { display: block; width: 100%; height: auto; }
  .tg-gun { transform-origin: 150px 110px; }
  .tg-stage.tremble .tg-gun { animation: tg-tremble .09s linear infinite; }
  @keyframes tg-tremble { 0% { transform: translate(0,0) rotate(0deg); } 25% { transform: translate(1.6px,-1px) rotate(.5deg); } 50% { transform: translate(-1.4px,.6px) rotate(-.5deg); } 75% { transform: translate(1px,1.4px) rotate(.35deg); } 100% { transform: translate(-.8px,-1.2px) rotate(-.35deg); } }
  .tg-stage.recoil .tg-gun { animation: tg-recoil .38s ease-out; }
  @keyframes tg-recoil { 0% { transform: translateX(0) rotate(0); } 22% { transform: translateX(-13px) rotate(-2.4deg); } 100% { transform: translateX(0) rotate(0); } }
  .tg-stage.clickshake .tg-gun { animation: tg-clickshake .22s ease-out; }
  @keyframes tg-clickshake { 0% { transform: translateX(0); } 35% { transform: translateX(-4px); } 100% { transform: translateX(0); } }
  .tg-hammer { transform-origin: 96px 62px; transition: transform .22s ease-in; }
  .tg-stage.pulling .tg-hammer { transform: rotate(-30deg); }
  .tg-stage.fall .tg-hammer { transform: rotate(4deg); transition: transform .06s ease-in; }
  .tg-trigger { transform-origin: 141px 106px; transition: transform .22s ease-in; }
  .tg-stage.pulling .tg-trigger { transform: rotate(20deg); }
  .tg-stage.heavy .tg-trigger { transition: transform 1.55s cubic-bezier(.6,.05,.85,.4); }
  .tg-stage.heavy .tg-hammer { transition: transform 1.55s cubic-bezier(.6,.05,.85,.4); }
  .tg-cyl { transition: transform .45s cubic-bezier(.3,1.4,.5,1); }
  /* レア: スローモーション（鼓動ズーム＋周囲が暗くなる） */
  .tg-stage.slowmo { box-shadow: inset 0 0 90px rgba(12,9,34,.55); }
  .tg-stage.slowmo svg { animation: tg-heartbeat 1.9s ease-in-out; transform-origin: 50% 55%; }
  @keyframes tg-heartbeat { 0%,100% { transform: scale(1); } 18% { transform: scale(1.045); } 34% { transform: scale(1.005); } 55% { transform: scale(1.065); } 74% { transform: scale(1.01); } }
  .tg-stage.slowmo .tg-hammer { transition-duration: 1.15s; }
  .tg-stage.slowmo .tg-trigger { transition-duration: 1.15s; }
  /* レア: 黄金の引き金（銃全体が金色に＋キラキラ） */
  .tg-stage.golden { --tg-gun: #e7ba4e; --tg-gun2: #b8860b; }
  .tg-stage.golden .tg-gun { filter: drop-shadow(0 0 13px rgba(217,164,65,.9)); }
  .tg-sparkles { position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity .3s; }
  .tg-stage.golden .tg-sparkles { opacity: 1; }
  .tg-sparkles i { position: absolute; width: 22px; height: 22px; background: radial-gradient(circle, #fff3b0 0 22%, #ffd94d 45%, rgba(255,217,77,0) 72%); clip-path: polygon(50% 0,62% 38%,100% 50%,62% 62%,50% 100%,38% 62%,0 50%,38% 38%); }
  .tg-stage.golden .tg-sparkles i { animation: tg-twinkle .85s ease-in-out infinite alternate; }
  .tg-sparkles i:nth-child(1) { left: 16%; top: 14%; }
  .tg-sparkles i:nth-child(2) { left: 56%; top: 6%; width: 16px; height: 16px; animation-delay: .25s; }
  .tg-sparkles i:nth-child(3) { left: 82%; top: 26%; animation-delay: .5s; }
  .tg-sparkles i:nth-child(4) { left: 34%; top: 38%; width: 14px; height: 14px; animation-delay: .15s; }
  .tg-sparkles i:nth-child(5) { left: 70%; top: 52%; width: 18px; height: 18px; animation-delay: .65s; }
  .tg-sparkles i:nth-child(6) { left: 8%; top: 52%; width: 15px; height: 15px; animation-delay: .4s; }
  @keyframes tg-twinkle { from { transform: scale(.45) rotate(0deg); opacity: .35; } to { transform: scale(1.15) rotate(35deg); opacity: 1; } }
  .tg-flashstar { opacity: 0; transform-origin: 330px 68px; }
  .tg-stage.bangflash .tg-flashstar { animation: tg-flashpop .34s ease-out; }
  @keyframes tg-flashpop { 0% { opacity: 1; transform: scale(.4) rotate(0deg); } 45% { opacity: 1; transform: scale(1.25) rotate(14deg); } 100% { opacity: 0; transform: scale(1.5) rotate(22deg); } }
  .tg-smoke { opacity: 0; }
  .tg-stage.bangflash .tg-smoke { animation: tg-smokeup 1.1s ease-out; }
  @keyframes tg-smokeup { 0% { opacity: .55; transform: translateY(0); } 100% { opacity: 0; transform: translateY(-16px); } }
  .tg-flash { position: absolute; inset: 0; background: radial-gradient(circle at 78% 32%, #fff6c9, #ff7b2e 70%); opacity: 0; pointer-events: none; }
  /* 発砲した弾のピクトグラムが銃口から弾けて出るポップ（実弾以外） */
  .tg-pop { position: absolute; left: 58%; top: 1%; opacity: 0; pointer-events: none; z-index: 6; }
  .tg-pop .pic.big { background: #fffdf7; border-color: #8887; box-shadow: 0 6px 20px rgba(0,0,0,.35); }
  .tg-pop.show { animation: tg-popfly 1.15s ease-out forwards; }
  @keyframes tg-popfly {
    0% { opacity: 0; transform: translate(96px, 54px) scale(.25) rotate(-14deg); }
    18% { opacity: 1; transform: translate(0, 0) scale(1.15) rotate(3deg); }
    32% { transform: translate(0, 0) scale(1) rotate(0deg); }
    70% { opacity: 1; transform: translate(-6px, -9px) scale(1); }
    100% { opacity: 0; transform: translate(-12px, -22px) scale(.94); }
  }
  .tg-stage.bangflash .tg-flash { animation: tg-screenflash .4s ease-out; }
  @keyframes tg-screenflash { 0% { opacity: .75; } 100% { opacity: 0; } }
  .tg-again { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; background: rgba(20,10,10,.38); pointer-events: none; text-align: center; z-index: 2; }
  .tg-again.show { display: flex; }
  .tg-again .big { font-size: clamp(30px, 9vw, 52px); font-weight: 900; color: #ffd94d; text-shadow: 0 3px 0 #8c1d22, 0 6px 22px rgba(0,0,0,.55); animation: tg-againpop .45s cubic-bezier(.2,1.8,.4,1); letter-spacing: .04em; padding: 0 10px; background: none; }
  @keyframes tg-againpop { 0% { transform: scale(.4) rotate(-4deg); opacity: 0; } 100% { transform: scale(1) rotate(-2deg); opacity: 1; } }
  .tg-tension { height: 10px; border-radius: 99px; background: #8883; overflow: hidden; margin: 2px 2px 8px; opacity: 0; transition: opacity .2s; }
  .tg-tension.on { opacity: 1; }
  .tg-tension i { display: block; height: 100%; width: 0%; background: linear-gradient(90deg, #d9a441, #b02a30); border-radius: 99px; }
  .tg-tension.go i { width: 100%; transition: width 1.55s cubic-bezier(.6,.05,.85,.4); }
  #animMsg { min-height: 1.4em; text-align: center; font-weight: 700; margin: 2px 0 8px; }
  /* 他プレイヤーの発砲アニメーション（観戦側ステージ） */
  .obs-cap { text-align: center; font-weight: 800; margin: 4px 0 0; font-size: 15px; }
  #obsStage { margin-bottom: 10px; }
  #fireBtn.again { background: #f08c00; border-color: #a85a00; color: #fff; animation: tg-pulse .9s ease-out infinite; }
  @keyframes tg-pulse { 0% { box-shadow: 0 0 0 0 rgba(240,140,0,.55); } 100% { box-shadow: 0 0 0 20px rgba(240,140,0,0); } }
  @media (prefers-reduced-motion: reduce) {
    .tg-stage.tremble .tg-gun, .tg-stage.recoil .tg-gun, .tg-stage.slowmo svg, .tg-stage.golden .tg-sparkles i, #fireBtn.again { animation: none; }
  }
  /* 表彰表示 */
  #awardCard { border: 2px solid #f5c542; background: #f5c54214; text-align: center; }
  .award-title { font-size: 18px; font-weight: 800; margin: 2px 0 6px; }
  .award-winner { font-size: 24px; font-weight: 800; color: #b8860b; margin: 4px 0; }
  .award-fin { font-size: 16px; margin: 4px 0; }
  .badge.clear { background: #f5c54255; font-weight: 700; }
</style>
</head>
<body>
  <h1>超幸運ロシアンパーティ</h1>
  <div id="flash"></div>
  <div id="fxBanner"></div>
  <div id="finalBanner"></div>

  <!-- カードピクトグラム定義（サンプル確定版・インラインSVG、画像ファイル不使用） -->
  <svg width="0" height="0" style="position:absolute" aria-hidden="true">
    <defs>
      <symbol id="i-live" viewBox="0 0 48 48">
        <path d="M24 3c3.2 4.2 5 8.4 5 13v5H19v-5c0-4.6 1.8-8.8 5-13z" fill="currentColor"/>
        <rect x="18" y="21" width="12" height="19" rx="2.5" fill="none" stroke="currentColor" stroke-width="3"/>
        <line x1="18" y1="29" x2="30" y2="29" stroke="currentColor" stroke-width="3"/>
      </symbol>
      <symbol id="i-deal" viewBox="0 0 48 48">
        <path d="M13 15a13 13 0 0 1 21-3" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/>
        <path d="M35 5v8h-8" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M35 33a13 13 0 0 1-21 3" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/>
        <path d="M13 43v-8h8" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M5 17l13 6.5-2.6 5.2L4 23.5z" fill="currentColor"/>
        <path d="M43 17L30 23.5l2.6 5.2L44 23.5z" fill="currentColor"/>
        <ellipse cx="24" cy="26.5" rx="6.4" ry="5.4" fill="currentColor"/>
        <path d="M19.5 30.5c1.5 2 3.2 3 5 3.2M23 32c1.4 1.6 3 2.4 4.8 2.5M26.5 31.4c1.2 1.3 2.6 2 4.2 2.1" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
      </symbol>
      <symbol id="i-amanojaku" viewBox="0 0 48 48">
        <path d="M15 42V13" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round"/>
        <path d="M7 20l8-9 8 9" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M33 6v29" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round"/>
        <path d="M25 28l8 9 8-9" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
      </symbol>
      <symbol id="i-kurayami" viewBox="0 0 48 48">
        <path d="M31 5a16.5 16.5 0 1 0 11 27A18.5 18.5 0 0 1 31 5z" fill="currentColor"/>
        <path d="M37 8l1.4 3.6L42 13l-3.6 1.4L37 18l-1.4-3.6L32 13l3.6-1.4z" fill="currentColor"/>
      </symbol>
      <symbol id="i-unmei" viewBox="0 0 48 48">
        <rect x="9" y="9" width="30" height="30" rx="7" fill="none" stroke="currentColor" stroke-width="3.4"/>
        <circle cx="17.5" cy="17.5" r="3.1" fill="currentColor"/>
        <circle cx="30.5" cy="17.5" r="3.1" fill="currentColor"/>
        <circle cx="24" cy="24" r="3.1" fill="currentColor"/>
        <circle cx="17.5" cy="30.5" r="3.1" fill="currentColor"/>
        <circle cx="30.5" cy="30.5" r="3.1" fill="currentColor"/>
      </symbol>
      <symbol id="i-reverse" viewBox="0 0 48 48">
        <path d="M10 19a15 15 0 0 1 25-8" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/>
        <path d="M36 4v9h-9" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M38 29a15 15 0 0 1-25 8" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/>
        <path d="M12 44v-9h9" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
      </symbol>
      <symbol id="i-mosaic" viewBox="0 0 48 48">
        <rect x="6" y="6" width="11" height="11" fill="currentColor"/>
        <rect x="21" y="5" width="11" height="11" fill="currentColor" opacity=".45"/>
        <rect x="35" y="8" width="10" height="10" fill="currentColor" transform="rotate(14 40 13)"/>
        <rect x="9" y="21" width="11" height="11" fill="currentColor" opacity=".45"/>
        <rect x="23" y="20" width="11" height="11" fill="currentColor"/>
        <rect x="36" y="23" width="10" height="10" fill="currentColor" opacity=".7" transform="rotate(-10 41 28)"/>
        <rect x="7" y="35" width="11" height="11" fill="currentColor" opacity=".7"/>
        <rect x="22" y="36" width="11" height="11" fill="currentColor" opacity=".45"/>
        <rect x="37" y="35" width="9" height="9" fill="currentColor"/>
      </symbol>
      <symbol id="i-takara" viewBox="0 0 48 48">
        <path d="M8 24a16 12 0 0 1 32 0z" fill="currentColor" opacity=".55"/>
        <rect x="8" y="24" width="32" height="17" rx="2" fill="none" stroke="currentColor" stroke-width="3.2"/>
        <line x1="8" y1="30" x2="40" y2="30" stroke="currentColor" stroke-width="3"/>
        <circle cx="24" cy="30" r="4.4" fill="none" stroke="currentColor" stroke-width="3"/>
        <circle cx="24" cy="30" r="1.4" fill="currentColor"/>
        <circle cx="38" cy="35" r="9.5" fill="#fff" stroke="currentColor" stroke-width="2.6"/>
        <path d="M33.8 29.6h8.4M33.8 40.4h8.4M34.8 29.6c0 4.4 6.4 4.4 6.4 10.8M41.2 29.6c0 4.4-6.4 4.4-6.4 10.8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
      </symbol>
      <symbol id="i-usagi" viewBox="0 0 48 48">
        <path d="M17 24c-3.4-9-3.4-17-1-20 3.4 3.4 5 11 4.4 18" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>
        <path d="M31 24c3.4-9 3.4-17 1-20-3.4 3.4-5 11-4.4 18" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>
        <circle cx="24" cy="33" r="11.5" fill="none" stroke="currentColor" stroke-width="3.2"/>
        <circle cx="20" cy="31.5" r="1.7" fill="currentColor"/>
        <circle cx="28" cy="31.5" r="1.7" fill="currentColor"/>
        <path d="M22.4 36.4h3.2l-1.6 2z" fill="currentColor"/>
      </symbol>
      <symbol id="i-saimin" viewBox="0 0 48 48">
        <path d="M24 24c1.8-.3 3.2 1 3.2 2.8 0 2-1.6 3.4-3.6 3.2-2.6-.3-4.3-2.6-3.9-5.2.5-3.3 3.4-5.5 6.8-5.1 4.2.5 7 4.3 6.4 8.5-.7 5-5 8.5-10 8-5.9-.6-10-5.8-9.4-11.7C10.3 17.3 16.6 12 24 12.6c8.3.7 14.3 8 13.6 16.3" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/>
      </symbol>
      <symbol id="i-fujimi" viewBox="0 0 48 48">
        <path d="M24 4l15 5.4V22c0 10.4-6.2 17.4-15 22C15.2 39.4 9 32.4 9 22V9.4z" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linejoin="round"/>
        <path d="M24 33.5s-7.2-4.9-7.2-9.6c0-2.3 1.7-3.9 3.7-3.9 1.5 0 2.9.9 3.5 2.2.6-1.3 2-2.2 3.5-2.2 2 0 3.7 1.6 3.7 3.9 0 4.7-7.2 9.6-7.2 9.6z" fill="currentColor"/>
      </symbol>
      <symbol id="i-damazumari" viewBox="0 0 48 48">
        <rect x="3" y="20" width="25" height="10" rx="2" fill="currentColor"/>
        <path d="M30 17l9 4.2-1.8 4.6-9-2.4z" fill="currentColor" opacity=".65" transform="rotate(8 34 22)"/>
        <path d="M33 6l9 9M42 6l-9 9" stroke="currentColor" stroke-width="3.6" stroke-linecap="round"/>
        <path d="M8 36h20" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" opacity=".5"/>
      </symbol>
      <symbol id="i-hengen" viewBox="0 0 48 48">
        <rect x="7" y="13" width="19" height="27" rx="3.5" fill="none" stroke="currentColor" stroke-width="3.2" transform="rotate(-9 16 26)"/>
        <rect x="21" y="8" width="19" height="27" rx="3.5" fill="#fff" stroke="currentColor" stroke-width="3.2" transform="rotate(7 30 21)"/>
        <path d="M38 34l1.3 3.4L42.5 38.7l-3.2 1.3L38 43.4l-1.3-3.4-3.2-1.3 3.2-1.3z" fill="currentColor"/>
        <path d="M10 4l.9 2.3 2.3.9-2.3.9L10 10.4l-.9-2.3-2.3-.9 2.3-.9z" fill="currentColor"/>
      </symbol>
      <symbol id="i-ubaiai" viewBox="0 0 48 48">
        <path d="M24 10c1.9 2.5 3 5 3 7.8v2.2h-6v-2.2c0-2.8 1.1-5.3 3-7.8z" fill="currentColor"/>
        <rect x="20.8" y="20" width="6.4" height="11" rx="1.4" fill="currentColor"/>
        <path d="M17 25H6M6 25l5-5M6 25l5 5" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M31 25h11M42 25l-5-5M42 25l-5 5" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M17 38h14" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity=".45"/>
      </symbol>
      <symbol id="i-uchikeshi" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="17" fill="none" stroke="currentColor" stroke-width="4"/>
        <line x1="12.5" y1="35.5" x2="35.5" y2="12.5" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>
      </symbol>
      <symbol id="i-nusumimi" viewBox="0 0 48 48">
        <path d="M3.5 24C9.5 14.6 16.4 10.5 24 10.5S38.5 14.6 44.5 24c-6 9.4-12.9 13.5-20.5 13.5S9.5 33.4 3.5 24z" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linejoin="round"/>
        <circle cx="24" cy="24" r="7" fill="none" stroke="currentColor" stroke-width="3.2"/>
        <circle cx="24" cy="24" r="2.8" fill="currentColor"/>
      </symbol>
      <symbol id="i-power" viewBox="0 0 48 48">
        <circle cx="14" cy="10.5" r="7.4" fill="currentColor"/>
        <path d="M7.8 14.8h12.6l1.1 16.6a7 7 0 0 1-13.9 0z" fill="currentColor"/>
        <ellipse cx="30" cy="26" rx="14.5" ry="11.5" fill="currentColor"/>
        <path d="M22 19.5c1.9 4.3 1.9 9.2 0 13.5" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round"/>
        <path d="M10.6 6.8v3.9M14.6 5.9v4.3M18.6 6.8v3.9" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
      </symbol>
      <symbol id="i-rule" viewBox="0 0 48 48">
        <path d="M7 37L4.5 15 17 23 24 8l7 15 12-8L41 37z" fill="currentColor"/>
        <rect x="7" y="40" width="34" height="4.6" rx="2.3" fill="currentColor"/>
        <circle cx="4.5" cy="12.5" r="2.8" fill="currentColor"/>
        <circle cx="43.5" cy="12.5" r="2.8" fill="currentColor"/>
        <circle cx="24" cy="6" r="2.8" fill="currentColor"/>
      </symbol>
    </defs>
  </svg>

  <div class="card" id="lobby">
    <div class="row">
      <input class="name" id="nameInput" placeholder="表示名" maxlength="12" autocomplete="off">
    </div>
    <p class="muted">名前を入れてから、部屋を作るか、コードで入ってください（4〜8人で対戦、以降は観戦）。</p>
    <div class="row">
      <button class="primary" id="createBtn">部屋を作る</button>
    </div>
    <div class="row" style="margin-top:10px;">
      <input class="code" id="codeInput" placeholder="ABCD" maxlength="4" autocomplete="off">
      <button id="joinBtn">部屋に入る</button>
    </div>
    <div id="msg"></div>
  </div>

  <div class="card" id="room" hidden>
    <div class="row" style="justify-content: space-between;">
      <span>部屋コード: <span class="big" id="roomCode"></span></span>
      <button id="copyBtn">招待リンクをコピー</button>
    </div>
    <p>あなたは <span class="big" id="myRole"></span> です</p>
    <ul class="plist" id="players"></ul>

    <div id="lobbyPanel" hidden>
      <p class="muted" id="lobbyNote"></p>
      <div class="row"><button class="primary" id="startBtn">ゲーム開始</button></div>
    </div>

    <div id="setupPanel" hidden>
      <p class="big">弾薬を6発、シリンダーに装填してください</p>
      <p class="muted">配られた7発の弾薬から6発を、タップした順番でリボルバーの弾倉（シリンダー）に装填します。<b>実弾を必ず1発含めてください。</b>余った1発は廃棄されます。タップし直すと選び直せます。</p>
      <div class="row" style="align-items:flex-start;">
        <div>
          <p class="muted" style="margin:2px 0;">あなたのシリンダー</p>
          <div id="setupCyl"></div>
        </div>
        <div style="flex:1; min-width:200px;">
          <p class="muted" style="margin:2px 0;">弾薬（手札）</p>
          <div class="hand" id="handGrid"></div>
        </div>
      </div>
      <p id="setInfo"></p>
      <p id="setWarn" style="color:#c0392b; min-height:1.2em;"></p>
      <div class="row"><button class="primary" id="submitBtn">この装填で確定</button></div>
    </div>

    <div id="setupWaitPanel" hidden>
      <p class="big">装填完了</p>
      <p class="muted">ほかのプレイヤーの装填を待っています…</p>
    </div>

    <div id="firePanel" hidden>
      <p class="big" id="turnStatus"></p>
      <div id="triggerStage" class="tg-stage" hidden>
        <div id="tgFlash" class="tg-flash"></div>
        <svg viewBox="0 0 340 200" role="img" aria-label="リボルバー">
          <g class="tg-gun">
            <path d="M96 104 L72 172 a11 11 0 0 0 9 14 l20 3 a11 11 0 0 0 12-8 l10-58 z" fill="var(--tg-wood)" stroke="rgba(0,0,0,.35)" stroke-width="2"/>
            <path d="M84 58 h118 v34 H96 a12 12 0 0 1-12-12z" fill="var(--tg-gun)" stroke="rgba(0,0,0,.35)" stroke-width="2"/>
            <rect x="196" y="56" width="126" height="21" rx="5" fill="var(--tg-gun2)"/>
            <rect x="196" y="50" width="112" height="7" rx="3" fill="var(--tg-gun)"/>
            <rect x="314" y="53" width="9" height="27" rx="3" fill="var(--tg-gun2)"/>
            <g class="tg-hammer">
              <path d="M96 62 L80 40 a7 7 0 0 1 10-9 l12 10 c3 3 3 8 0 12 l-3 6z" fill="var(--tg-gun2)" stroke="rgba(0,0,0,.3)" stroke-width="1.6"/>
            </g>
            <g class="tg-cyl" id="tgCyl" style="transform-origin:150px 86px;">
              <circle cx="150" cy="86" r="35" fill="var(--tg-gun)" stroke="rgba(0,0,0,.4)" stroke-width="2"/>
              <circle cx="150" cy="67" r="9.5" fill="var(--tg-gun2)"/>
              <circle cx="166.5" cy="76.5" r="9.5" fill="var(--tg-gun2)"/>
              <circle cx="166.5" cy="95.5" r="9.5" fill="var(--tg-gun2)"/>
              <circle cx="150" cy="105" r="9.5" fill="var(--tg-gun2)"/>
              <circle cx="133.5" cy="95.5" r="9.5" fill="var(--tg-gun2)"/>
              <circle cx="133.5" cy="76.5" r="9.5" fill="var(--tg-gun2)"/>
              <circle cx="150" cy="86" r="6.5" fill="#d9a441"/>
            </g>
            <path d="M118 104 a24 17 0 0 0 46 0" fill="none" stroke="var(--tg-gun2)" stroke-width="5" stroke-linecap="round"/>
            <g class="tg-trigger">
              <path d="M141 102 c1 8-1 14-6 19" fill="none" stroke="var(--tg-gun2)" stroke-width="6.5" stroke-linecap="round"/>
            </g>
            <g class="tg-flashstar">
              <polygon points="330,68 342,54 346,66 360,58 352,70 364,76 350,78 354,92 343,82 336,94 334,79 320,82 328,71 318,62" fill="#ffb62e" stroke="#f08c00" stroke-width="2" stroke-linejoin="round"/>
              <circle cx="338" cy="72" r="7" fill="#fff3b0"/>
            </g>
            <g class="tg-smoke" fill="#9aa0ad">
              <circle cx="330" cy="46" r="7"/>
              <circle cx="342" cy="38" r="9"/>
              <circle cx="322" cy="34" r="5"/>
            </g>
          </g>
        </svg>
        <div class="tg-sparkles" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
        <div class="tg-pop" id="tgPop"></div>
        <div class="tg-again" id="tgAgain"><div class="big">もう一度引け！</div></div>
      </div>
      <div class="tg-tension" id="tgTension"><i></i></div>
      <p id="animMsg"></p>
      <div class="row"><button class="primary" id="fireBtn">引き金を引く</button></div>
    </div>

    <div id="overPanel" hidden>
      <p class="big" id="resultText"></p>
      <div class="row"><button class="primary" id="againBtn">もう一度遊ぶ</button></div>
      <p class="muted" id="againNote"></p>
    </div>
  </div>

  <div class="card" id="awardCard" hidden>
    <div id="awardBody"></div>
  </div>

  <div class="card" id="actionCard" hidden>
    <p class="big" id="actionTitle" style="margin-top:0;"></p>
    <p class="muted" id="actionDesc"></p>
    <div id="actionBody"></div>
  </div>

  <div class="card" id="fieldCard" hidden>
    <div id="shotBanner"></div>
    <p id="fieldStatus" style="margin:4px 0;"></p>
    <p class="muted">オレンジ色に光る薬室が、次に発砲される弾です。各弾には持ち主の色と名前の頭文字のバッジが付いていて、誰の弾か全員に分かります（弾の中身は公開されるまで誰にも分かりません）。</p>
    <div id="obsStage" class="tg-stage" hidden>
      <p class="obs-cap" id="obsCaption"></p>
      <div class="tg-flash"></div>
      <svg viewBox="0 0 340 200" role="img" aria-label="相手のリボルバー">
        <g class="tg-gun">
          <path d="M96 104 L72 172 a11 11 0 0 0 9 14 l20 3 a11 11 0 0 0 12-8 l10-58 z" fill="var(--tg-wood)" stroke="rgba(0,0,0,.35)" stroke-width="2"/>
          <path d="M84 58 h118 v34 H96 a12 12 0 0 1-12-12z" fill="var(--tg-gun)" stroke="rgba(0,0,0,.35)" stroke-width="2"/>
          <rect x="196" y="56" width="126" height="21" rx="5" fill="var(--tg-gun2)"/>
          <rect x="196" y="50" width="112" height="7" rx="3" fill="var(--tg-gun)"/>
          <rect x="314" y="53" width="9" height="27" rx="3" fill="var(--tg-gun2)"/>
          <g class="tg-hammer">
            <path d="M96 62 L80 40 a7 7 0 0 1 10-9 l12 10 c3 3 3 8 0 12 l-3 6z" fill="var(--tg-gun2)" stroke="rgba(0,0,0,.3)" stroke-width="1.6"/>
          </g>
          <g class="tg-cyl" style="transform-origin:150px 86px;">
            <circle cx="150" cy="86" r="35" fill="var(--tg-gun)" stroke="rgba(0,0,0,.4)" stroke-width="2"/>
            <circle cx="150" cy="67" r="9.5" fill="var(--tg-gun2)"/>
            <circle cx="166.5" cy="76.5" r="9.5" fill="var(--tg-gun2)"/>
            <circle cx="166.5" cy="95.5" r="9.5" fill="var(--tg-gun2)"/>
            <circle cx="150" cy="105" r="9.5" fill="var(--tg-gun2)"/>
            <circle cx="133.5" cy="95.5" r="9.5" fill="var(--tg-gun2)"/>
            <circle cx="133.5" cy="76.5" r="9.5" fill="var(--tg-gun2)"/>
            <circle cx="150" cy="86" r="6.5" fill="#d9a441"/>
          </g>
          <path d="M118 104 a24 17 0 0 0 46 0" fill="none" stroke="var(--tg-gun2)" stroke-width="5" stroke-linecap="round"/>
          <g class="tg-trigger">
            <path d="M141 102 c1 8-1 14-6 19" fill="none" stroke="var(--tg-gun2)" stroke-width="6.5" stroke-linecap="round"/>
          </g>
          <g class="tg-flashstar">
            <polygon points="330,68 342,54 346,66 360,58 352,70 364,76 350,78 354,92 343,82 336,94 334,79 320,82 328,71 318,62" fill="#ffb62e" stroke="#f08c00" stroke-width="2" stroke-linejoin="round"/>
            <circle cx="338" cy="72" r="7" fill="#fff3b0"/>
          </g>
          <g class="tg-smoke" fill="#9aa0ad">
            <circle cx="330" cy="46" r="7"/>
            <circle cx="342" cy="38" r="9"/>
            <circle cx="322" cy="34" r="5"/>
          </g>
        </g>
      </svg>
      <div class="tg-sparkles" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
      <div class="tg-pop"></div>
      <div class="tg-again"><div class="big">もう一度引け！</div></div>
      <div class="tg-tension"><i></i></div>
    </div>
    <div class="field" id="field"></div>
  </div>

  <div class="card" id="noteCard" hidden>
    <p class="big" style="margin-top:0;">盗み見メモ（あなただけに見えます）</p>
    <ul id="noteList" style="margin:0; padding-left:18px; font-size:14px;"></ul>
  </div>

  <div class="card" id="logCard" hidden>
    <p class="big" style="margin-top:0;">ログ</p>
    <ul id="log"></ul>
  </div>

<script src="/socket.io/socket.io.js"></script>
<script>
  var socket = io();
  var myId = null;
  var myRole = null; // 'player' | 'spectator'
  var state = null;
  var selected = []; // 装填選択中の弾薬uid（タップ順）
  var handKey = '';
  var actKey = '';       // 効果解決UIのローカル状態リセット用キー
  var actSel = [];       // 対象2人・配布選択などの一時選択（uidやplayerId）
  var actAssign = { next: null, prev: null }; // 裏取引の割り当て
  var actRot = 0;        // 暗闇の回転量

  var LABEL = { live: '実弾', deal: '裏取引', amanojaku: '天邪鬼', kurayami: '暗闇', unmei: '運命', reverse: 'リバース', mosaic: 'ランダムモザイク', takara: '宝の持ち腐れ', usagi: 'ウサギ跳び', saimin: '催眠', fujimi: '不死身', damazumari: '弾詰まり', hengen: '変幻', ubaiai: '奪い合い', uchikeshi: '打ち消し', nusumimi: '盗み見', power: '圧倒的なパワー', rule: '私がルール' };
  var KANJI = { live: '実', deal: '裏', amanojaku: '天', kurayami: '暗', unmei: '運', reverse: 'リ', mosaic: 'モ', takara: '宝', usagi: 'ウ', saimin: '催', fujimi: '不', damazumari: '弾', hengen: '変', ubaiai: '奪', uchikeshi: '打', nusumimi: '盗', power: '圧', rule: 'ル' };
  var DESC = { live: '引くと残機−1で脱落', deal: '全員が両隣に弾を渡し合う', amanojaku: '対象の残弾の順序を反転', kurayami: '2人の残弾を全て交換', unmei: '全員で弾を回収・再配布', reverse: 'プレイ順を反対周りに', mosaic: '対象の残弾をシャッフル', takara: '脱落者と残弾を全て交換', usagi: '対象の弾倉を1つ回転', saimin: '対象が即座に発砲する', fujimi: '次の自手番終了まで実弾を無効', damazumari: '対象は次の手番で発砲しない', hengen: '使用済みの弾の効果をコピー', ubaiai: '2人が互いの弾を1発ずつ交換', uchikeshi: '保護か、効果を1つ打ち消す', nusumimi: '対象の残弾の中身を見る', power: '実弾が次のプレイヤーまで貫通', rule: '実弾が次のプレイヤーを撃つ' };
  var DARKTEXT = { usagi: true };
  // ピクトグラム（サンプルの色分けをそのまま採用）
  var COLOR = { live: '#b02a30', deal: '#6f42c1', amanojaku: '#0e7c86', kurayami: '#4a4f57', unmei: '#c2185b', reverse: '#2a7d4f', mosaic: '#8d6e00', takara: '#b8860b', usagi: '#d16a72', saimin: '#5a4fcf', fujimi: '#2e8b57', damazumari: '#795548', hengen: '#7b2d8b', ubaiai: '#c05621', uchikeshi: '#4a6fa5', nusumimi: '#607d8b', power: '#e64a19', rule: '#3550a8' };
  function pic(type, cls) {
    return '<span class="pic ' + (cls || '') + '" style="color:' + (COLOR[type] || '#888') + '"><svg aria-hidden="true"><use href="#i-' + type + '"/></svg></span>';
  }
  // 使用済みの弾（公開済みのみ）の履歴チップ列
  function histChips(cards) {
    var h = '<span class="hist">';
    cards.forEach(function (c, i) {
      var title = LABEL[c.type] + (c.ownerName ? '（' + c.ownerName + 'の弾）' : '');
      h += '<span class="hchip" style="color:' + (COLOR[c.type] || '#888') + '" title="' + esc(title) + '">'
        + (c.ownerColor ? '<span class="own" style="background:' + c.ownerColor + '">' + esc(c.ownerInitial) + '</span>' : '')
        + pic(c.type, 'sm')
        + '<span class="hn">' + LABEL[c.type] + '</span><span class="ord">' + (i + 1) + '発目</span></span>';
    });
    return h + '</span>';
  }
  // 発砲アニメーションのステージ内に、その弾のピクトグラムを銃口から弾けるように出す。
  // 実弾は従来どおりフラッシュのみ（呼び出し側で実弾以外でのみ呼ぶ）。
  function showStagePop(stageEl, type) {
    if (!stageEl) return;
    var pop = stageEl.querySelector('.tg-pop');
    if (!pop) return;
    pop.innerHTML = pic(type, 'big');
    pop.classList.remove('show');
    void pop.offsetWidth;
    pop.classList.add('show');
  }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function hearts(n) { var s = ''; for (var i = 0; i < n; i++) s += '♥'; return s || '―'; }
  function myName() { return $('nameInput').value.trim() || ''; }

  var params = new URLSearchParams(location.search);
  if (params.get('room')) $('codeInput').value = params.get('room').toUpperCase();

  $('createBtn').onclick = function () { socket.emit('createRoom', { name: myName() }); };
  $('joinBtn').onclick = function () { socket.emit('joinRoom', { code: $('codeInput').value, name: myName() }); };
  $('startBtn').onclick = function () { socket.emit('startGame'); };
  $('fireBtn').onclick = function () { onTriggerPull(); };
  $('againBtn').onclick = function () { socket.emit('playAgain'); };
  $('copyBtn').onclick = async function () {
    var url = location.origin + '/?room=' + state.code;
    try { await navigator.clipboard.writeText(url); $('myRole').textContent = roleText() + '（リンクをコピーしました）'; }
    catch (e) { window.prompt('招待リンク', url); }
  };
  $('submitBtn').onclick = function () { socket.emit('submitSet', { uids: selected.slice() }); };

  function roleText() {
    if (myRole === 'spectator') return '観戦者';
    var me = state && state.players.find(function (p) { return p.id === myId; });
    return me ? 'プレイヤー「' + me.name + '」' : 'プレイヤー';
  }

  socket.on('connect', function () { myId = socket.id; });
  socket.on('roomJoined', function (j) {
    myRole = j.role;
    $('roomCode').textContent = j.code;
    $('lobby').hidden = true;
    $('room').hidden = false;
    $('logCard').hidden = false;
  });
  socket.on('errorMessage', function (m) { $('msg').textContent = m; var w = $('setWarn'); if (w) w.textContent = m; });

  socket.on('state', function (s) {
    state = s;
    render();
  });

  // 発砲エフェクトはサーバーが発砲の瞬間に送る専用イベントでのみ再生する。
  // （状態の差分で検出すると、途中参加・再接続・ページ再読み込み後の
  //   初回 state で過去の発砲まで再生されてしまうため）
  socket.on('shot', function (shot) {
    if (shot.playerId === myId) {
      // 自分の発砲は、引き金アニメーションの発砲タイミングに合わせて表示するため
      // アニメーション中は保持する（アニメーションが無い経路の発砲は即時表示）
      if (animBusy || againPending) {
        heldShots.push(shot);
        if (impactWait) { impactWait = false; applyStageImpact(shot); }
        return;
      }
      animateShot(shot);
      return;
    }
    // 他プレイヤーの発砲は、種別つきアニメーションを観戦側ステージで再生してから公開する
    playObserverShot(shot);
  });

  function animateShot(shot) {
    var wrap = $('cylwrap-' + shot.playerId);
    if (wrap) {
      var svg = wrap.querySelector('svg');
      if (svg) {
        svg.classList.remove('cylspin');
        void svg.getBoundingClientRect();
        svg.classList.add('cylspin');
        setTimeout(function () { svg.classList.remove('cylspin'); }, 500);
      }
    }
    var banner = $('shotBanner');
    if (shot.type === 'live') {
      banner.innerHTML = pic('live', 'big')
        + '<div>💥 バーン！ ' + esc(shot.name) + ' の弾は実弾だった！</div>';
      banner.className = 'bang';
      var fl = $('flash');
      fl.classList.remove('go');
      void fl.offsetWidth;
      fl.classList.add('go');
    } else {
      banner.innerHTML = pic(shot.type, 'big')
        + '<div>カチッ… ' + esc(shot.name) + ' の弾は「' + LABEL[shot.type] + '」だった</div>';
      banner.className = 'click';
    }
    setTimeout(function () { if (banner.textContent) { banner.innerHTML = ''; banner.className = ''; } }, 2600);
  }

  // ===== 自分の手番の引き金アニメーション =====
  // サンプルページで確定した演出の移植（弾倉スピンは不採用）。
  // 抽選はこのクライアント内で行い、サーバーや他プレイヤーの進行には影響しない。
  // レアは合計 約6%（各種1.5%）＝1ラウンドに1〜2回出る程度の目安。
  // 結果の公開（バナー等）は発砲タイミングまで保持し、ゲーム進行自体は遅らせない。
  var animBusy = false;      // アニメーション再生中
  var againPending = false;  // レア「もう一度引け！」の2回目待ち
  var heldShots = [];        // アニメ完了まで保持する自分の shot イベント
  var impactWait = false;    // 発砲タイミングを過ぎて結果待ちの場合に即反映する
  var tgCylRot = 0;
  var animTimers = [];
  function tgLater(fn, ms) { animTimers.push(setTimeout(fn, ms)); }
  function tgClearTimers() { animTimers.forEach(clearTimeout); animTimers = []; }
  function tgStage() { return $('triggerStage'); }
  function tgReset() {
    tgStage().classList.remove('pulling', 'fall', 'tremble', 'heavy', 'recoil', 'clickshake', 'bangflash', 'slowmo', 'golden');
    $('tgTension').classList.remove('on', 'go');
    // ピクトグラムのポップは消さない（自身のアニメーションで opacity 0 に収束する）
  }
  function tgSpinCyl() { tgCylRot += 60; $('tgCyl').style.transform = 'rotate(' + tgCylRot + 'deg)'; }
  function setAnimMsg(t) { $('animMsg').textContent = t || ''; }
  function resetFireBtn() {
    var b = $('fireBtn');
    b.textContent = '引き金を引く';
    b.classList.remove('again');
  }
  // --- 簡易サウンド（WebAudio合成・ファイル不使用。サンプルと同じ） ---
  var actx = null;
  function ensureAudio() {
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      return actx;
    } catch (e) { return null; }
  }
  function sndClick(weak) {
    var a = ensureAudio(); if (!a) return;
    var o = a.createOscillator(), g = a.createGain();
    o.type = 'square'; o.frequency.value = weak ? 900 : 1500;
    g.gain.setValueAtTime(weak ? 0.05 : 0.09, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + (weak ? 0.09 : 0.05));
    o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + 0.1);
  }
  function sndBang() {
    var a = ensureAudio(); if (!a) return;
    var len = a.sampleRate * 0.4, buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
    var src = a.createBufferSource(); src.buffer = buf;
    var f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    var g = a.createGain(); g.gain.value = 0.5;
    src.connect(f); f.connect(g); g.connect(a.destination); src.start();
    var o = a.createOscillator(), og = a.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(120, a.currentTime);
    o.frequency.exponentialRampToValueAtTime(38, a.currentTime + 0.3);
    og.gain.setValueAtTime(0.5, a.currentTime);
    og.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.35);
    o.connect(og); og.connect(a.destination); o.start(); o.stop(a.currentTime + 0.36);
  }
  function sndChime() {
    var a = ensureAudio(); if (!a) return;
    [1568, 2093].forEach(function (fr, i) {
      var o = a.createOscillator(), g = a.createGain();
      o.type = 'sine'; o.frequency.value = fr;
      var t = a.currentTime + i * 0.12;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.08, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + 0.55);
    });
  }
  function tgVibrate(p) { if (navigator.vibrate) { try { navigator.vibrate(p); } catch (e) {} } }

  function myTurnActive() {
    return state && state.phase === 'firing' && !state.pending
      && state.turnId === myId && myRole === 'player';
  }
  function onTriggerPull() {
    ensureAudio();
    if (animBusy) return;
    if (againPending) { playAgainSecond(); return; }
    if (!myTurnActive()) return;
    var r = Math.random();
    if (r < 0.015) playHeavy();
    else if (r < 0.030) playAgainFirst();
    else if (r < 0.045) playSlow();
    else if (r < 0.060) playGold();
    else playNormalShot();
  }
  // 発砲リクエストを送る（サーバー処理はこのタイミングで進む）
  // 抽選した演出種別を一緒に送り、サーバーが 'shot' イベントで全員へ転送する。
  // 他プレイヤーの画面では、その種別のアニメーションが再生されてから結果が公開される。
  var currentAnim = 'normal'; // この発砲で抽選した演出種別
  function requestFire() {
    tgStage().classList.add('fall');
    impactWait = true;
    socket.emit('fire', { anim: currentAnim });
  }
  // 自分の銃の発砲タイミングの見た目＋保持していた結果表示を出す
  function applyStageImpact(shot) {
    var st = tgStage();
    if (shot.type === 'live') {
      sndBang(); tgVibrate([60, 40, 90]);
      st.classList.add('bangflash', 'recoil');
    } else {
      sndClick(false); tgVibrate(25);
      st.classList.add('clickshake');
      showStagePop(st, shot.type);
    }
    animateShot(shot);
  }
  function impactMyShot() {
    var shot = heldShots.shift();
    if (shot) { impactWait = false; applyStageImpact(shot); }
    // まだ届いていない場合は impactWait のまま。届いた瞬間に shot ハンドラが反映する
  }
  function finishAnim() {
    tgReset();
    setAnimMsg('');
    animBusy = false;
    impactWait = false;
    currentAnim = 'normal';
    resetFireBtn();
    // 保持したまま残った自分の発砲結果があれば通常表示で出す
    while (heldShots.length) animateShot(heldShots.shift());
    if (state) render();
  }
  function beginAnim() {
    animBusy = true;
    impactWait = false;
    $('fireBtn').disabled = true;
  }

  // 通常演出: 引き金→ハンマー→シリンダー回転→間→発砲（約1秒）
  function playNormalShot() {
    currentAnim = 'normal';
    beginAnim();
    setAnimMsg('……');
    tgStage().classList.add('pulling'); tgSpinCyl();
    tgLater(requestFire, 340);
    tgLater(impactMyShot, 430);
    tgLater(finishAnim, 1020);
  }
  // レア: 引き金が重い（約2.2秒）
  function playHeavy() {
    currentAnim = 'heavy';
    beginAnim();
    setAnimMsg('引き金が…重い…！');
    $('fireBtn').textContent = '重い…！ 引き切れ…！';
    var st = tgStage();
    st.classList.add('pulling', 'heavy', 'tremble');
    var tension = $('tgTension');
    tension.classList.add('on');
    void tension.offsetWidth;
    tension.classList.add('go');
    tgSpinCyl();
    tgVibrate([30, 60, 30, 60, 30, 60, 30]);
    tgLater(function () { st.classList.remove('tremble'); }, 1500);
    tgLater(requestFire, 1620);
    tgLater(impactMyShot, 1710);
    tgLater(finishAnim, 2300);
  }
  // レア: もう一度引け！（1回目は不発演出のみ。発砲リクエストは送らない）
  function playAgainFirst() {
    beginAnim();
    setAnimMsg('……');
    tgStage().classList.add('pulling'); tgSpinCyl();
    tgLater(function () {
      tgStage().classList.add('fall');
      tgLater(function () {
        sndClick(true);
        tgStage().classList.add('clickshake');
        tgLater(function () {
          tgReset();
          setAnimMsg('カチッ…？ あれ、不発だ…！');
          $('tgAgain').classList.add('show');
          againPending = true;
          animBusy = false;
          var b = $('fireBtn');
          b.textContent = 'もう一度引け！';
          b.classList.add('again');
          b.disabled = false;
          tgVibrate([40, 40, 40]);
        }, 260);
      }, 70);
    }, 340);
  }
  function playAgainSecond() {
    currentAnim = 'again';
    againPending = false;
    $('tgAgain').classList.remove('show');
    resetFireBtn();
    beginAnim();
    setAnimMsg('今度こそ……');
    tgStage().classList.add('pulling'); tgSpinCyl();
    tgLater(requestFire, 300);
    tgLater(impactMyShot, 390);
    tgLater(finishAnim, 980);
  }
  // レア: スローモーション（約2.1秒）
  function playSlow() {
    currentAnim = 'slow';
    beginAnim();
    setAnimMsg('ドクン…ドクン… 時がゆっくり流れる…');
    $('fireBtn').textContent = 'ドクン… ドクン…';
    tgStage().classList.add('pulling', 'slowmo');
    tgSpinCyl();
    tgVibrate([70, 150, 70, 150, 70]);
    tgLater(function () { tgStage().classList.remove('slowmo'); }, 1960);
    tgLater(requestFire, 1960);
    tgLater(impactMyShot, 2050);
    tgLater(finishAnim, 2640);
  }
  // レア: 黄金の引き金（約1.5秒）
  function playGold() {
    currentAnim = 'gold';
    beginAnim();
    setAnimMsg('引き金が黄金に輝いた…！');
    $('fireBtn').textContent = '黄金の引き金…！';
    tgStage().classList.add('pulling', 'golden');
    tgSpinCyl();
    sndChime();
    tgVibrate(40);
    tgLater(requestFire, 1280);
    tgLater(impactMyShot, 1370);
    tgLater(finishAnim, 1960);
  }
  // 発砲フェイズを離れたらアニメーション状態を安全に畳む
  function cancelAnim() {
    tgClearTimers();
    tgReset();
    animBusy = false;
    againPending = false;
    impactWait = false;
    currentAnim = 'normal';
    heldShots = [];
    $('tgAgain').classList.remove('show');
    setAnimMsg('');
    resetFireBtn();
  }

  // ===== 他プレイヤーの発砲アニメーション（観戦側ステージ） =====
  // 'shot' イベントに載って届いた演出種別を、発砲者のリボルバー用ステージ
  // （場の表示の上にある #obsStage）で再生し、結果の公開（バナー／フラッシュ）は
  // アニメーションの発砲タイミングまで保持する。本人の画面の保持仕組みと同じ考え方。
  // 演出はこの画面の中だけの見た目であり、サーバーの進行や選択UIの受付は止めない。
  // 通常種別（normal / 種別なし）は従来どおり即時公開する。
  var OBS_RARE = { heavy: true, again: true, slow: true, gold: true };
  var obsBusy = false;
  var obsQueue = [];      // 再生中は後続の他者の shot を順番待ちさせる（公開順序を保つ）
  var obsTimers = [];
  var obsCylRot = 0;
  var obsShot = null;     // 再生中の shot
  var obsRevealed = true; // 再生中の shot の公開が済んだか
  function obLater(fn, ms) { obsTimers.push(setTimeout(fn, ms)); }
  function obClearTimers() { obsTimers.forEach(clearTimeout); obsTimers = []; }
  function obStage() { return $('obsStage'); }
  function obPart(sel) { var st = obStage(); return st ? st.querySelector(sel) : null; }
  function obReset() {
    var st = obStage(); if (!st) return;
    st.classList.remove('pulling', 'fall', 'tremble', 'heavy', 'recoil', 'clickshake', 'bangflash', 'slowmo', 'golden');
    var t = obPart('.tg-tension'); if (t) t.classList.remove('on', 'go');
    var a = obPart('.tg-again'); if (a) a.classList.remove('show');
  }
  function obSpinCyl() {
    obsCylRot += 60;
    var c = obPart('.tg-cyl'); if (c) c.style.transform = 'rotate(' + obsCylRot + 'deg)';
  }
  function playObserverShot(shot) {
    if (obsBusy || obsQueue.length) { obsQueue.push(shot); return; }
    // レア種別でない／ステージが無い環境では即時公開（フォールバック）
    if (!OBS_RARE[shot.anim] || !obStage()) { animateShot(shot); return; }
    startObsAnim(shot);
  }
  function startObsAnim(shot) {
    obsBusy = true;
    obsShot = shot;
    obsRevealed = false;
    obReset();
    var st = obStage();
    st.hidden = false;
    $('obsCaption').textContent = shot.name + ' が引き金を引いた…';
    obSpinCyl();
    var impactAt, finishAt;
    if (shot.anim === 'heavy') {
      // 引き金が重い: 本人画面と同じタイミング（震え→ゆっくり引き切る→発砲）
      st.classList.add('pulling', 'heavy', 'tremble');
      var t = obPart('.tg-tension');
      if (t) { t.classList.add('on'); void t.offsetWidth; t.classList.add('go'); }
      obLater(function () { st.classList.remove('tremble'); }, 1500);
      obLater(function () { st.classList.add('fall'); }, 1620);
      impactAt = 1710; finishAt = 2300;
    } else if (shot.anim === 'slow') {
      // スローモーション: 本人画面と同じタイミング（鼓動ズーム→発砲）
      st.classList.add('pulling', 'slowmo');
      obLater(function () { st.classList.remove('slowmo'); st.classList.add('fall'); }, 1960);
      impactAt = 2050; finishAt = 2640;
    } else if (shot.anim === 'gold') {
      // 黄金の引き金: 本人画面と同じタイミング（金色に輝く→発砲）
      st.classList.add('pulling', 'golden');
      obLater(function () { st.classList.add('fall'); }, 1280);
      impactAt = 1370; finishAt = 1960;
    } else { // again: 観戦側は短縮版（不発→「もう一度引け！」→本発砲、合計 約1.2秒で公開）
      st.classList.add('pulling');
      obLater(function () { st.classList.add('fall'); }, 180);
      obLater(function () { st.classList.add('clickshake'); }, 250);
      obLater(function () {
        st.classList.remove('fall', 'clickshake');
        var a = obPart('.tg-again'); if (a) a.classList.add('show');
        $('obsCaption').textContent = shot.name + ' の銃が不発…！？';
      }, 430);
      obLater(function () {
        var a = obPart('.tg-again'); if (a) a.classList.remove('show');
        $('obsCaption').textContent = shot.name + ' がもう一度引いた！';
        st.classList.add('pulling');
        obSpinCyl();
      }, 800);
      obLater(function () { st.classList.add('fall'); }, 940);
      impactAt = 1030; finishAt = 1500;
    }
    obLater(revealObsShot, impactAt);
    obLater(finishObsAnim, finishAt);
    // 最大保持時間のフォールバック: タイマーが進まない環境（バックグラウンド等）でも
    // 一定時間後には必ず公開してステージを畳む
    obLater(function () {
      if (!obsRevealed) revealObsShot();
      if (obsBusy) finishObsAnim();
    }, finishAt + 1800);
  }
  function revealObsShot() {
    if (!obsShot || obsRevealed) return;
    obsRevealed = true;
    var st = obStage();
    if (st) {
      if (obsShot.type === 'live') st.classList.add('bangflash', 'recoil');
      else { st.classList.add('clickshake'); showStagePop(st, obsShot.type); }
    }
    animateShot(obsShot);
  }
  function finishObsAnim() {
    obClearTimers();
    obReset();
    var st = obStage(); if (st) st.hidden = true;
    obsBusy = false;
    obsShot = null;
    obsRevealed = true;
    // 順番待ちの shot を処理する（通常種別は即時公開、レアは続けて再生）
    while (obsQueue.length) {
      var next = obsQueue.shift();
      if (OBS_RARE[next.anim] && obStage()) { startObsAnim(next); return; }
      animateShot(next);
    }
  }

  // シリンダーSVG生成
  // slots: 長さ6の配列。各要素は null（空） / {mode:'set', type} / {mode:'loaded', ownerColor, ownerInitial}
  function chPos(i) {
    var a = (-90 + i * 60) * Math.PI / 180;
    return [50 + 30 * Math.cos(a), 50 + 30 * Math.sin(a)];
  }
  function cylinderSVG(slots, size, nextIdx) {
    var h = '<svg viewBox="0 0 100 100" width="' + size + '" height="' + size + '">';
    h += '<circle cx="50" cy="50" r="47" class="cyl-bg"/>';
    for (var i = 0; i < 6; i++) {
      var pos = chPos(i), x = pos[0].toFixed(1), y = pos[1].toFixed(1);
      var slot = slots[i];
      if (!slot) {
        h += '<circle cx="' + x + '" cy="' + y + '" r="13" class="ch ch-empty"/>';
        h += '<text x="' + x + '" y="' + (pos[1] + 3).toFixed(1) + '" text-anchor="middle" class="chnum">' + (i + 1) + '</text>';
      } else if (slot.mode === 'set') {
        h += '<circle cx="' + x + '" cy="' + y + '" r="13" class="ch ch-set-' + slot.type + '"/>';
        h += '<text x="' + x + '" y="' + (pos[1] + 4).toFixed(1) + '" text-anchor="middle" class="cht' + (DARKTEXT[slot.type] ? ' dark' : '') + '">' + KANJI[slot.type] + '</text>';
      } else { // loaded（伏せた弾）: 持ち主の色＋頭文字バッジを付ける（全員に見える）
        h += '<circle cx="' + x + '" cy="' + y + '" r="13" class="ch ch-loaded' + (i === nextIdx ? ' ch-next' : '') + '"/>';
        h += '<circle cx="' + x + '" cy="' + y + '" r="4.2" class="brass"/>';
        if (slot.ownerColor) {
          var bx = (pos[0] + 9.5).toFixed(1), by = (pos[1] - 9.5).toFixed(1);
          h += '<circle cx="' + bx + '" cy="' + by + '" r="5" fill="' + slot.ownerColor + '" stroke="#fff" stroke-width=".9"/>';
          h += '<text x="' + bx + '" y="' + (pos[1] - 9.5 + 2.4).toFixed(1) + '" text-anchor="middle" class="owninit">' + esc(slot.ownerInitial) + '</text>';
        }
      }
    }
    h += '<circle cx="50" cy="50" r="10" class="cyl-center"/>';
    h += '</svg>';
    return h;
  }

  function render() {
    var s = state;
    if (!s) return;
    $('myRole').textContent = roleText();

    var html = '';
    s.players.forEach(function (p) {
      html += '<li><span class="pchip" style="background:' + p.color + '">' + esc(p.initial) + '</span><span>' + esc(p.name) + '</span>'
        + '<span class="hearts">' + hearts(p.lives) + '</span>'
        + (p.isHost ? '<span class="badge host">ホスト</span>' : '')
        + (p.out ? '<span class="badge out">このラウンド退場</span>' : '')
        + (p.invincible ? '<span class="badge fx">不死身</span>' : '')
        + (p.protected ? '<span class="badge fx">保護中</span>' : '')
        + (p.jammed ? '<span class="badge fx">弾詰まり</span>' : '')
        + (p.cleared ? '<span class="badge clear">🎯 全弾撃ち切り</span>' : '')
        + (s.phase === 'setup' && p.submitted ? '<span class="badge ready">装填済</span>' : '')
        + (!p.connected ? '<span class="badge">切断中</span>' : '')
        + (p.id === myId ? '<span class="badge">あなた</span>' : '')
        + '</li>';
    });
    if (!s.players.length) html = '<li class="muted">まだいません</li>';
    $('players').innerHTML = html;

    $('lobbyPanel').hidden = s.phase !== 'lobby';
    $('setupPanel').hidden = !(s.phase === 'setup' && myRole === 'player' && !s.you.submitted && s.myHand);
    $('setupWaitPanel').hidden = !(s.phase === 'setup' && (myRole !== 'player' || s.you.submitted || !s.myHand));
    $('firePanel').hidden = s.phase !== 'firing';
    $('overPanel').hidden = s.phase !== 'gameover';
    $('fieldCard').hidden = s.phase === 'lobby';

    if (s.phase === 'lobby') {
      $('lobbyNote').textContent = '現在 ' + s.playerCount + ' 人。' + s.minPlayers + '人以上でホストが開始できます（最大' + s.maxPlayers + '人）。';
      var st = $('startBtn');
      st.disabled = !(s.you.isHost && s.playerCount >= s.minPlayers);
      st.textContent = s.you.isHost ? 'ゲーム開始' : 'ホストの開始を待っています';
    }

    if (s.phase === 'setup' && myRole === 'player' && !s.you.submitted && s.myHand) renderSetup(s);

    if (s.phase === 'firing') {
      var turnP = s.players.find(function (p) { return p.id === s.turnId; });
      var mine = s.turnId === myId && myRole === 'player';
      // 引き金アニメーションのステージは、自分の手番（と演出の継続中）だけ表示する
      $('triggerStage').hidden = !(myRole === 'player' && (mine || animBusy || againPending));
      if (s.pending) {
        $('turnStatus').textContent = '「' + LABEL[s.pending.cardType] + '」の効果を解決中です…';
        $('fireBtn').disabled = true;
      } else {
        $('turnStatus').textContent = mine ? 'あなたの番です。引き金を引いてください。'
          : ('いまは ' + (turnP ? turnP.name : '―') + ' の番です');
        $('fireBtn').disabled = !mine || animBusy;
      }
    } else {
      $('triggerStage').hidden = true;
      if (animBusy || againPending) cancelAnim();
    }

    if (s.phase === 'gameover') {
      var names = (s.winners || []).map(function (w) { return w.name; }).join('・');
      $('resultText').textContent = 'ゲーム終了！ 優勝は ' + names + ' です';
      $('againBtn').disabled = !s.you.isHost;
      $('againNote').textContent = s.you.isHost ? '残機をリセットして、同じ部屋でもう一度遊べます。' : 'ホストが「もう一度遊ぶ」を押すと再戦できます。';
    }

    // 場の状態（進行方向・フィールド効果）
    var fs = '';
    if (s.phase === 'firing' || s.phase === 'gameover') {
      fs = '進行方向: ' + (s.direction === 1 ? '時計回り' : '反時計回り');
      if (s.field && s.field.power) fs += '　<span class="badge fx">圧倒的なパワー発動中</span>';
      if (s.field && s.field.rule) fs += '　<span class="badge fx">私がルール発動中</span>';
    }
    $('fieldStatus').innerHTML = fs;

    // フィールド効果の可視化: 発動中は画面全体の色調を変え、上部に大きなバッジを出す。
    // ラウンド終了（次ラウンドのsetupでは field が消えている）や打ち消しで解除されれば通常に戻る。
    var fxP = !!(s.field && s.field.power);
    var fxR = !!(s.field && s.field.rule);
    var fxOn = (s.phase === 'firing' || s.phase === 'gameover') && (fxP || fxR);
    document.body.classList.toggle('fx-power', fxOn && fxP && !fxR);
    document.body.classList.toggle('fx-rule', fxOn && fxR && !fxP);
    document.body.classList.toggle('fx-both', fxOn && fxP && fxR);
    var banner = $('fxBanner');
    if (fxOn) {
      var bh = '';
      if (fxP) bh += '<span class="fxchip power">🔥 圧倒的なパワー発動中</span>';
      if (fxR) bh += '<span class="fxchip rule">👑 私がルール発動中</span>';
      if (fxP && fxR) bh += '<span class="fxnote">⚡ 同時発動中！ 実弾は次のプレイヤーと、さらにその次のプレイヤーを撃ちます</span>';
      banner.innerHTML = bh;
      banner.className = 'show';
    } else {
      banner.innerHTML = '';
      banner.className = '';
    }

    // 最終ラウンドの表示（残機0が出たラウンドは全員に明示する）
    var fb = $('finalBanner');
    if (s.finalRound && s.phase === 'firing') {
      fb.innerHTML = '<span class="finalchip">⚠ 最終ラウンド ― このラウンドで決着します</span>';
      fb.className = 'show';
    } else {
      fb.innerHTML = '';
      fb.className = '';
    }

    renderAward(s);
    // 自分の引き金アニメーション中は、効果解決UIの表示をアニメ完了まで遅らせる
    if (!animBusy) renderAction(s);
    renderField(s);
    renderNotes(s);

    var logHtml = '';
    s.log.slice().reverse().forEach(function (line) { logHtml += '<li>' + esc(line) + '</li>'; });
    $('log').innerHTML = logHtml;
  }

  // 表彰表示: ラウンド終了時（次ラウンドの装填画面）とゲーム終了時に出す
  function renderAward(s) {
    var card = $('awardCard');
    var html = '';
    if (s.phase === 'gameover') {
      var names = (s.winners || []).map(function (w) { return esc(w.name); }).join('・');
      html = '<p class="award-title">🏆 ゲーム優勝 🏆</p>'
        + '<p class="award-winner">' + names + '</p>';
      var fin = s.roundFinishers || [];
      if (fin.length) {
        html += '<p class="award-fin">🎯 最終ラウンドで全弾を無事に撃ち切った人: <b>'
          + fin.map(function (f) { return esc(f.name); }).join('・') + '</b></p>';
      }
    } else if (s.phase === 'setup' && s.lastRound) {
      var lr = s.lastRound;
      html = '<p class="award-title">🏆 ラウンド' + lr.round + ' の表彰 🏆</p>';
      if (lr.winners && lr.winners.length) {
        html += '<p class="award-winner">ラウンド勝者: '
          + lr.winners.map(function (w) { return esc(w.name); }).join('・') + '</p>';
      }
      if (lr.finishers && lr.finishers.length) {
        html += '<p class="award-fin">🎯 全弾を無事に撃ち切った人: <b>'
          + lr.finishers.map(function (f) { return esc(f.name); }).join('・') + '</b></p>';
      }
      if ((!lr.winners || !lr.winners.length) && (!lr.finishers || !lr.finishers.length)) {
        html += '<p class="muted">表彰対象はいませんでした</p>';
      }
    }
    card.hidden = !html;
    if (html) $('awardBody').innerHTML = html;
  }

  function renderNotes(s) {
    var notes = s.myPeekNotes || [];
    $('noteCard').hidden = !notes.length;
    if (!notes.length) return;
    var html = '';
    notes.forEach(function (n) {
      html += '<li>' + esc(n.targetName) + ' の残弾: '
        + histChips(n.types.map(function (t) { return { type: t }; })) + '</li>';
    });
    $('noteList').innerHTML = html;
  }

  function renderSetup(s) {
    var hand = s.myHand || [];
    var key = hand.map(function (c) { return c.uid; }).join(',');
    if (key !== handKey) { handKey = key; selected = []; }
    var byUid = {};
    hand.forEach(function (c) { byUid[c.uid] = c; });

    var slots = [];
    for (var i = 0; i < 6; i++) {
      slots.push(selected[i] ? { mode: 'set', type: byUid[selected[i]].type } : null);
    }
    $('setupCyl').innerHTML = cylinderSVG(slots, 170, -1);

    var html = '';
    hand.forEach(function (c) {
      var idx = selected.indexOf(c.uid);
      html += '<button class="hcard ' + c.type + (idx >= 0 ? ' sel' : '') + '" data-uid="' + c.uid + '">'
        + (idx >= 0 ? '<span class="ord">' + (idx + 1) + '</span>' : '')
        + pic(c.type, 'mid')
        + '<span>' + LABEL[c.type] + '</span>'
        + '<span class="sub">' + DESC[c.type] + '</span>'
        + '</button>';
    });
    $('handGrid').innerHTML = html;
    Array.prototype.forEach.call($('handGrid').children, function (el) {
      el.onclick = function () {
        var uid = el.getAttribute('data-uid');
        var i = selected.indexOf(uid);
        if (i >= 0) selected.splice(i, 1);
        else if (selected.length < 6) selected.push(uid);
        render();
      };
    });
    var hasLive = hand.some(function (c) { return c.type === 'live' && selected.indexOf(c.uid) >= 0; });
    $('setInfo').textContent = '装填中: ' + selected.length + ' / 6 発';
    $('setWarn').textContent = selected.length === 6 && !hasLive ? '実弾が含まれていません。実弾を必ず1発装填してください。' : '';
    $('submitBtn').disabled = !(selected.length === 6 && hasLive);
  }

  function renderField(s) {
    var byId = {};
    s.players.forEach(function (p) { byId[p.id] = p; });
    var html = '';
    s.rows.forEach(function (row) {
      var p = byId[row.playerId];
      if (!p) return;
      var unrev = row.cards.filter(function (c) { return !c.revealed; });
      var slots = unrev.slice(0, 6).map(function (c) { return { mode: 'loaded', ownerColor: c.ownerColor, ownerInitial: c.ownerInitial }; });
      while (slots.length < 6) slots.push(null);
      var nextIdx = (s.phase === 'firing' && !p.out && unrev.length) ? 0 : -1;
      html += '<div class="prow' + (s.phase === 'firing' && s.turnId === p.id ? ' turn' : '') + '">'
        + '<div id="cylwrap-' + p.id + '">' + cylinderSVG(slots, 118, nextIdx) + '</div>'
        + '<div class="phead">'
        + '<span class="big" style="font-size:16px;"><span class="pchip" style="background:' + p.color + '">' + esc(p.initial) + '</span>' + esc(p.name) + '</span>'
        + '<span class="pmeta"><span class="hearts">' + hearts(p.lives) + '</span>'
        + (p.out ? '<span class="badge out">退場</span>' : '')
        + (p.cleared ? '<span class="badge clear">🎯 全弾撃ち切り</span>' : '')
        + (row.cards.length ? '<span class="badge">残り ' + unrev.length + ' 発</span>' : '')
        + '</span>'
        + revealedChips(row)
        + '<span class="muted">' + esc(revealedSummary(row)) + '</span>'
        + '</div></div>';
    });
    $('field').innerHTML = html || '<p class="muted">まだ装填されていません</p>';
  }

  // 使用済みの弾の履歴: アイコンのチップで一目で分かるようにする（公開済みの弾だけ）
  function revealedChips(row) {
    var rev = row.cards.filter(function (c) { return c.revealed; });
    if (!rev.length) return '';
    return histChips(rev);
  }

  function revealedSummary(row) {
    var parts = [];
    var n = 0;
    row.cards.forEach(function (c) {
      if (c.revealed) { n++; parts.push(n + '発目:' + c.ownerName + 'の弾'); }
    });
    return parts.length ? parts.join(' / ') : 'まだ発砲していません';
  }

  // ===== 効果解決UI =====
  function renderAction(s) {
    var card = $('actionCard');
    var p = s.pending;
    if (!p || s.phase !== 'firing') { card.hidden = true; actKey = ''; return; }
    card.hidden = false;
    $('actionTitle').innerHTML = pic(p.cardType, 'sm') + ' 「' + LABEL[p.cardType] + '」の効果（' + esc(p.actorName) + '）';
    var key = p.kind + '|' + p.actorId + '|' + p.cardType + '|' + (p.myTask ? p.myTask.kind : 'wait');
    if (key !== actKey) { actKey = key; actSel = []; actAssign = { next: null, prev: null }; actRot = 0; }
    var body = $('actionBody');
    if (!p.myTask) {
      $('actionDesc').textContent = p.waitingNames.length
        ? (p.waitingNames.join('・') + ' の入力を待っています…')
        : '効果を処理しています…';
      body.innerHTML = '';
      return;
    }
    var t = p.myTask;
    if (t.kind === 'target') buildTargetUI(body, t);
    else if (t.kind === 'uchikeshi') buildUchikeshiUI(body, t);
    else if (t.kind === 'hengen') buildHengenUI(body, t);
    else if (t.kind === 'dealGive') buildDealGiveUI(body, t);
    else if (t.kind === 'unmeiGive') buildUnmeiGiveUI(body, t);
    else if (t.kind === 'stealPick') buildStealPickUI(body, t);
    else if (t.kind === 'place') buildPlaceUI(body, t);
    else if (t.kind === 'rotate') buildRotateUI(body, t);
    else { $('actionDesc').textContent = ''; body.innerHTML = ''; }
  }

  function btn(text, cls) {
    var b = document.createElement('button');
    b.textContent = text;
    if (cls) b.className = cls;
    return b;
  }
  // 持ち主タグ（色ドット＋頭文字＋「◯◯の弾」）。選択UIの弾ボタンに付ける
  function ownerTag(c) {
    if (!c || !c.ownerColor) return '';
    return ' <span class="owntag"><span class="owndot" style="background:' + c.ownerColor + '">' + esc(c.ownerInitial) + '</span>' + esc(c.ownerName) + 'の弾</span>';
  }

  function buildTargetUI(body, t) {
    $('actionDesc').textContent = t.count === 2
      ? '対象のプレイヤーを2人選んでください（自分も選べます）'
      : '対象のプレイヤーを1人選んでください（自分も選べます）';
    body.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'actbtns';
    t.candidates.forEach(function (cand) {
      var b = btn(cand.name, 'pick' + (actSel.indexOf(cand.id) >= 0 ? ' sel' : ''));
      b.onclick = function () {
        if (t.count === 1) { socket.emit('act', { playerId: cand.id }); return; }
        var i = actSel.indexOf(cand.id);
        if (i >= 0) actSel.splice(i, 1);
        else if (actSel.length < 2) actSel.push(cand.id);
        render();
      };
      wrap.appendChild(b);
    });
    body.appendChild(wrap);
    if (t.count === 2) {
      var ok = btn('この2人で確定', 'primary');
      ok.disabled = actSel.length !== 2;
      ok.onclick = function () { socket.emit('act', { playerIds: actSel.slice() }); };
      body.appendChild(ok);
    }
  }

  function buildUchikeshiUI(body, t) {
    $('actionDesc').textContent = '打ち消しの効果を1つ選んでください';
    body.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'actbtns';
    t.options.forEach(function (o) {
      var text = o.key === 'protect' ? '自分は次の手番開始時まで、効果の対象に選ばれない'
        : o.key === 'cancelField' ? '「' + LABEL[o.field] + '」を打ち消す'
        : o.name + ' の「不死身」を打ち消す';
      var b = btn(text, 'pick');
      b.onclick = function () {
        if (o.key === 'protect') socket.emit('act', { option: 'protect' });
        else if (o.key === 'cancelField') socket.emit('act', { option: 'cancelField', field: o.field });
        else socket.emit('act', { option: 'cancelFujimi', playerId: o.playerId });
      };
      wrap.appendChild(b);
    });
    body.appendChild(wrap);
  }

  function buildHengenUI(body, t) {
    $('actionDesc').textContent = 'このラウンドで使用済みの弾から、コピーする効果を1つ選んでください';
    body.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'actbtns';
    t.options.forEach(function (o) {
      var b = btn('', 'pick');
      b.innerHTML = pic(o.type, 'sm') + '<span>「' + LABEL[o.type] + '」（' + esc(o.byName) + 'が発砲）</span>';
      b.onclick = function () { socket.emit('act', { uid: o.uid }); };
      wrap.appendChild(b);
    });
    body.appendChild(wrap);
  }

  function cardPickButtons(body, cards, isSel, onTap) {
    var wrap = document.createElement('div');
    wrap.className = 'actbtns';
    cards.forEach(function (c, i) {
      var b = btn((i + 1) + '番の弾', 'pick' + (isSel(c) ? ' sel' : ''));
      var tag = ownerTag(c);
      if (tag) { var sp = document.createElement('span'); sp.innerHTML = tag; b.appendChild(sp); }
      b.onclick = function () { onTap(c); };
      wrap.appendChild(b);
    });
    body.appendChild(wrap);
  }

  function buildDealGiveUI(body, t) {
    $('actionDesc').textContent = '両隣へ渡す弾を選んでください。タップで「次の席→前の席」の順に割り当てます';
    body.innerHTML = '';
    var info = document.createElement('div');
    function slotText(which, name) {
      var uid = actAssign[which];
      var pos = uid ? (t.cards.findIndex(function (c) { return c.uid === uid; }) + 1) : null;
      return '<p class="slotline">' + (which === 'next' ? '次の席' : '前の席') + '（' + esc(name) + '）へ: '
        + (pos ? pos + '番の弾' : '未選択') + '</p>';
    }
    info.innerHTML = slotText('next', t.nextName) + slotText('prev', t.prevName);
    body.appendChild(info);
    cardPickButtons(body, t.cards, function (c) {
      return actAssign.next === c.uid || actAssign.prev === c.uid;
    }, function (c) {
      if (actAssign.next === c.uid) actAssign.next = null;
      else if (actAssign.prev === c.uid) actAssign.prev = null;
      else if (!actAssign.next) actAssign.next = c.uid;
      else if (!actAssign.prev) actAssign.prev = c.uid;
      render();
    });
    var need = Math.min(2, t.cards.length);
    var ok = btn('渡す弾を確定', 'primary');
    var assigned = (actAssign.next ? 1 : 0) + (actAssign.prev ? 1 : 0);
    ok.disabled = assigned !== need || (need === 2 && !actAssign.next);
    ok.onclick = function () { socket.emit('act', { giveNext: actAssign.next, givePrev: actAssign.prev }); };
    body.appendChild(ok);
  }

  function buildUnmeiGiveUI(body, t) {
    $('actionDesc').textContent = '回収する弾を ' + t.count + ' 発選んでください（全員分をシャッフルして配り直します）';
    body.innerHTML = '';
    cardPickButtons(body, t.cards, function (c) { return actSel.indexOf(c.uid) >= 0; }, function (c) {
      var i = actSel.indexOf(c.uid);
      if (i >= 0) actSel.splice(i, 1);
      else if (actSel.length < t.count) actSel.push(c.uid);
      render();
    });
    var ok = btn('この弾で確定', 'primary');
    ok.disabled = actSel.length !== t.count;
    ok.onclick = function () { socket.emit('act', { uids: actSel.slice() }); };
    body.appendChild(ok);
  }

  function buildStealPickUI(body, t) {
    $('actionDesc').textContent = t.fromName + ' の残弾から、奪う弾を1発選んでください';
    body.innerHTML = '';
    cardPickButtons(body, t.cards, function () { return false; }, function (c) {
      socket.emit('act', { uid: c.uid });
    });
  }

  function buildPlaceUI(body, t) {
    var cur = t.inbox[0];
    $('actionDesc').textContent = '受け取った弾を装填してください（あと ' + t.inbox.length + ' 発）'
      + (cur && cur.ownerName ? ' ― この弾は ' + cur.ownerName + ' の弾です' : '');
    body.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'actbtns';
    for (var i = 0; i <= t.count; i++) {
      var text = i === 0 ? '先頭に装填' : i === t.count ? '最後尾に装填' : (i + 1) + '番目に装填';
      (function (idx) {
        var b = btn(text, 'pick');
        b.onclick = function () { socket.emit('act', { index: idx }); };
        wrap.appendChild(b);
      })(i);
    }
    body.appendChild(wrap);
  }

  function buildRotateUI(body, t) {
    $('actionDesc').textContent = '弾倉の回転量を決めてください（開始位置がずれます）';
    body.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'row';
    var minus = btn('◀');
    minus.onclick = function () { actRot = (actRot + t.count - 1) % Math.max(1, t.count); render(); };
    var label = document.createElement('span');
    label.className = 'big';
    label.textContent = actRot + ' つ回転';
    var plus = btn('▶');
    plus.onclick = function () { actRot = (actRot + 1) % Math.max(1, t.count); render(); };
    var ok = btn('確定', 'primary');
    ok.onclick = function () { socket.emit('act', { rotation: actRot }); };
    wrap.appendChild(minus); wrap.appendChild(label); wrap.appendChild(plus); wrap.appendChild(ok);
    body.appendChild(wrap);
  }
</script>
</body>
</html>
`;


const server = http.createServer((req, res) => {
  if (req.url === '/healthz') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true })); return; }
  if (req.url.startsWith('/socket.io/')) return; // socket.io が処理する
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(HTML);
});
const io = new Server(server);

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
let uidSeq = 1;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function newCard(type, ownerId) {
  // uid は生成順が分からないランダム形式にする（連番だと「最初に作られた弾＝実弾」と
  // 生成順から中身を推測できてしまうため）。一意性はカウンタ部分で担保する。
  return { uid: 'c' + (++uidSeq).toString(36) + Math.random().toString(36).slice(2, 9), type, ownerId, revealed: false };
}
function buildDeck() {
  const deck = [];
  for (const [type, n] of Object.entries(DECK)) {
    for (let i = 0; i < n; i++) deck.push(type);
  }
  return shuffle(deck);
}
// 1人分の手札: 実弾×1＋裏取引×1（確定）＋山札から5枚
function buildHand(playerId, deck) {
  const cards = [newCard('live', playerId), newCard('deal', playerId)];
  for (let i = 0; i < CONFIG.handSize - 2; i++) cards.push(newCard(deck.pop(), playerId));
  return shuffle(cards);
}

// rooms: code -> room
// room = {
//   code, hostId, phase, round, players, sockets,
//   hands: Map<playerId, card[]|null>, rows: Map<playerId, card[]>,
//   submitted: Set, out: Set, turnId, log, winners,
//   direction: 1|-1, fieldPower, fieldRule,
//   treasureQueue: [{playerId}], peekNotes: Map<playerId, note[]>,
//   pending: null | {...}, rig: null | rounds
// }
// player = { id, name, lives, connected, invincible, invJustSet, protFlag, protJustSet, jammed }
const rooms = new Map();

function newCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}
function newPlayer(id, name) {
  return {
    id, name, lives: CONFIG.initialLives, connected: true,
    invincible: false, invJustSet: false, protFlag: false, protJustSet: false, jammed: false,
  };
}
function newRoom(code, hostId) {
  return {
    code, hostId, phase: 'lobby', round: 1,
    players: [], sockets: new Map(),
    hands: new Map(), rows: new Map(),
    submitted: new Set(), out: new Set(),
    turnId: null, log: [], winners: null,
    direction: 1, fieldPower: false, fieldRule: false,
    treasureQueue: [], peekNotes: new Map(), pending: null, rig: null,
    finalRound: false, // 誰かの残機が0になったら立つ。そのラウンドを最後まで行ってから終了する
    roundShots: new Map(), roundCleared: new Set(), lastRoundResult: null,
    shotQueue: [], // 発砲エフェクト用: fireShot が積み、sendAll が state の直後に1回だけ配信する
  };
}
function addLog(room, text) {
  room.log.push(text);
  if (room.log.length > 300) room.log.splice(0, room.log.length - 300);
}
function playerOf(room, id) { return room.players.find((p) => p.id === id) || null; }
function nameOf(room, id) { const p = playerOf(room, id); return p ? p.name : '？'; }
// 持ち主マーキング用のプレイヤー色（座席＝参加順で固定。最大8人分）
const PLAYER_COLORS = ['#d93636', '#2470c9', '#2e9e4f', '#e07f00', '#7d3fc9', '#d6336c', '#0e8a8a', '#8a6d00'];
function colorOf(room, id) {
  const i = room.players.findIndex((p) => p.id === id);
  return i >= 0 ? PLAYER_COLORS[i % PLAYER_COLORS.length] : '#888888';
}
function initialOf(name) { const s = Array.from(String(name || '')); return s.length ? s[0] : '？'; }
// 伏せ弾の持ち主表示情報（公開してよいのは持ち主だけ。中身は含めない）
function ownerView(room, c) {
  return {
    ownerId: c.ownerId,
    ownerName: nameOf(room, c.ownerId),
    ownerColor: colorOf(room, c.ownerId),
    ownerInitial: initialOf(nameOf(room, c.ownerId)),
  };
}

// ===== 列（弾倉）の操作: 公開済みは常に接頭辞、未公開が残弾 =====
function rowOf(room, pid) { return room.rows.get(pid) || []; }
function unrevealed(room, pid) { return rowOf(room, pid).filter((c) => !c.revealed); }
function revealedCount(room, pid) { return rowOf(room, pid).filter((c) => c.revealed).length; }
function splitRow(room, pid) {
  const row = rowOf(room, pid);
  const i = row.findIndex((c) => !c.revealed);
  if (i < 0) return { rev: row.slice(), un: [] };
  return { rev: row.slice(0, i), un: row.slice(i) };
}
function setSuffix(room, pid, newUn) {
  const { rev } = splitRow(room, pid);
  room.rows.set(pid, [...rev, ...newUn]);
}
function rotateSuffix(room, pid, k) {
  const un = unrevealed(room, pid);
  if (un.length < 2) return;
  const r = ((k % un.length) + un.length) % un.length;
  if (!r) return;
  setSuffix(room, pid, [...un.slice(r), ...un.slice(0, r)]);
}
function reverseSuffix(room, pid) {
  setSuffix(room, pid, unrevealed(room, pid).slice().reverse());
}
function shuffleSuffix(room, pid) {
  setSuffix(room, pid, shuffle(unrevealed(room, pid)));
}
function swapSuffixes(room, aId, bId) {
  const a = unrevealed(room, aId);
  const b = unrevealed(room, bId);
  setSuffix(room, aId, b);
  setSuffix(room, bId, a);
}
function removeByUid(room, pid, uid) {
  const row = rowOf(room, pid);
  const i = row.findIndex((c) => c.uid === uid && !c.revealed);
  if (i < 0) return null;
  return row.splice(i, 1)[0];
}
function insertUnrevealed(room, pid, card, index) {
  const { rev, un } = splitRow(room, pid);
  const idx = Math.max(0, Math.min(index, un.length));
  un.splice(idx, 0, card);
  room.rows.set(pid, [...rev, ...un]);
}

// 進行方向に沿って、fromId の次にラウンドに残っているプレイヤー（exclude は除外）
function nextRemainingId(room, fromId, exclude) {
  const order = room.players;
  const n = order.length;
  const from = order.findIndex((p) => p.id === fromId);
  if (from < 0) return null;
  for (let step = 1; step < n; step++) {
    const p = order[(((from + room.direction * step) % n) + n) % n];
    if (room.out.has(p.id)) continue;
    if (exclude && exclude.has(p.id)) continue;
    return p.id;
  }
  return null;
}
function remainingPlayers(room) { return room.players.filter((p) => !room.out.has(p.id)); }

// ===== 個別化した状態配信 =====
// 伏せカードの中身(type)は、公開されるまで誰の画面にも絶対に送らない。
// ただし持ち主は全員に公開する（2026-11-19仕様変更）: 未公開の弾にも
// ownerId / ownerName / ownerColor / ownerInitial を付け、全プレイヤーと観戦者が
// 「どれが誰の弾か」を色＋頭文字の印で識別できるようにする。
// uid はランダム形式で生成順から中身を推測できないようにしてある（newCard 参照）。
// 盗み見メモは見た本人にだけ送る。他人の秘匿情報は一切含めない。
function stateFor(room, viewerId) {
  const viewer = playerOf(room, viewerId);
  const isPlayer = !!viewer;
  let myHand = null;
  if (isPlayer && room.phase === 'setup' && !room.submitted.has(viewerId)) {
    const hand = room.hands.get(viewerId);
    if (hand) myHand = hand.map((c) => ({ uid: c.uid, type: c.type }));
  }
  return {
    code: room.code,
    phase: room.phase,
    round: room.round,
    finalRound: room.finalRound,
    direction: room.direction,
    field: { power: room.fieldPower, rule: room.fieldRule },
    you: {
      id: viewerId,
      isPlayer,
      isHost: room.hostId === viewerId,
      submitted: room.submitted.has(viewerId),
    },
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      color: colorOf(room, p.id),
      initial: initialOf(p.name),
      lives: p.lives,
      isHost: p.id === room.hostId,
      out: room.out.has(p.id),
      submitted: room.submitted.has(p.id),
      connected: p.connected,
      invincible: p.invincible,
      protected: p.protFlag,
      jammed: p.jammed,
      shots: room.roundShots.get(p.id) || 0,
      cleared: room.roundCleared.has(p.id),
    })),
    playerCount: room.players.length,
    minPlayers: CONFIG.minPlayers,
    maxPlayers: CONFIG.maxPlayers,
    myHand,
    myPeekNotes: isPlayer ? (room.peekNotes.get(viewerId) || []) : [],
    rows: room.players.map((p) => ({
      playerId: p.id,
      cards: rowOf(room, p.id).map((c) => (c.revealed
        ? { uid: c.uid, revealed: true, type: c.type, ...ownerView(room, c) }
        : { uid: c.uid, revealed: false, mine: c.ownerId === viewerId, ...ownerView(room, c) })),
    })),
    turnId: room.phase === 'firing' ? room.turnId : null,
    pending: pendingFor(room, viewerId),
    log: room.log.slice(-80),
    winners: room.phase === 'gameover' ? room.winners : null,
    // 表彰用（いずれも公開情報のみ: 誰が何発撃ち、誰が撃ち切ったか）
    lastRound: room.lastRoundResult,
    roundFinishers: room.players
      .filter((p) => room.roundCleared.has(p.id))
      .map((p) => ({ id: p.id, name: p.name })),
  };
}
function sendAll(room) {
  for (const [id, sock] of room.sockets) {
    sock.emit('state', stateFor(room, id));
  }
  // 発砲エフェクトは専用イベントで1回だけ配信する（state の再送では再生しない）。
  // state の直後に送ることで、公開された弾が描画された直後にアニメーションする。
  if (room.shotQueue && room.shotQueue.length) {
    const shots = room.shotQueue;
    room.shotQueue = [];
    for (const sock of room.sockets.values()) {
      for (const sh of shots) sock.emit('shot', sh);
    }
  }
}

// ===== ゲーム進行 =====
function startGame(room) {
  for (const p of room.players) p.lives = CONFIG.initialLives;
  room.round = 1;
  room.winners = null;
  room.finalRound = false;
  room.lastRoundResult = null;
  room.log = [];
  addLog(room, 'ゲーム開始！ 全員の残機は ' + CONFIG.initialLives + ' です');
  startRound(room);
}

function startRound(room) {
  room.phase = 'setup';
  room.turnId = null;
  room.out = new Set();
  room.submitted = new Set();
  room.hands = new Map();
  room.rows = new Map();
  room.pending = null;
  room.direction = 1;
  room.fieldPower = false;
  room.fieldRule = false;
  room.treasureQueue = [];
  room.peekNotes = new Map();
  room.roundShots = new Map();
  room.roundCleared = new Set();
  room.shotQueue = [];
  for (const p of room.players) {
    p.invincible = false; p.invJustSet = false;
    p.protFlag = false; p.protJustSet = false; p.jammed = false;
    room.rows.set(p.id, []);
  }
  const deck = buildDeck();
  const rigRound = room.rig && room.rig[room.round - 1];
  room.players.forEach((p, i) => {
    if (rigRound && Array.isArray(rigRound[i])) {
      room.hands.set(p.id, rigRound[i].map((t) => newCard(t, p.id)));
    } else {
      room.hands.set(p.id, buildHand(p.id, deck));
    }
  });
  addLog(room, 'ラウンド' + room.round + '： カードが配られました。6発装填してください');
}

function startFiring(room) {
  room.phase = 'firing';
  const first = room.players.find((p) => p.connected) || room.players[0];
  room.turnId = first ? first.id : null;
  addLog(room, '全員の装填が完了。発砲フェイズ開始！');
}

// 手番開始時の処理（打ち消し保護は「次の自分の手番開始時まで」なので、
// 手番が回ってきた時点で失効する。保護の発動は必ず自分の手番内なので、
// 発動した手番の開始時にこの処理が走ることはない）
function startOfTurnHooks(room, p) {
  if (p.protFlag) {
    p.protFlag = false;
    addLog(room, p.name + ' の保護（打ち消し）が切れました');
  }
}
// 手番終了時の処理（不死身は「次の自分の手番終了時まで」）
function endOfTurnHooks(room, p) {
  if (p.invincible) {
    if (p.invJustSet) p.invJustSet = false;
    else { p.invincible = false; addLog(room, p.name + ' の不死身が切れました'); }
  }
}

// 残機0のプレイヤーが出たら、そのラウンドを「最終ラウンド」にする。
// ゲームは即終了せず、ラウンドを最後まで（残り1人になるまで）プレイしてから終了する。
function updateFinalRound(room) {
  if (room.finalRound) return;
  const zero = room.players.filter((p) => p.lives <= 0);
  if (!zero.length) return;
  room.finalRound = true;
  addLog(room, '⚠ ' + zero.map((p) => p.name).join('・')
    + ' の残機が0になったため、このラウンドが最終ラウンドになりました');
}

function checkEnd(room) {
  updateFinalRound(room);
  const remaining = remainingPlayers(room);
  if (remaining.length <= 1) {
    // ラウンド終了。最終ラウンドならそのままゲーム終了、それ以外は次のラウンドへ
    if (room.finalRound) gameOver(room); else endRound(room);
    return true;
  }
  const someoneCanFire = remaining.some((p) => p.connected
    && unrevealed(room, p.id).length > 0);
  if (!someoneCanFire) {
    if (room.finalRound) gameOver(room); else endRound(room);
    return true;
  }
  return false;
}

function finishTurn(room) {
  if (room.phase !== 'firing' || room.pending) return;
  if (checkEnd(room)) return;
  setNextTurn(room);
}

// 現在の手番プレイヤーから進行方向へ次のプレイヤーを探す（退場・切断・残弾0・弾詰まりはスキップ）
function setNextTurn(room) {
  const order = room.players;
  const n = order.length;
  const cur = order.findIndex((p) => p.id === room.turnId);
  for (let step = 1; step <= n; step++) {
    const p = order[(((cur + room.direction * step) % n) + n) % n];
    if (room.out.has(p.id) || !p.connected) continue;
    startOfTurnHooks(room, p);
    if (p.jammed) {
      p.jammed = false;
      addLog(room, p.name + ' は弾詰まりで発砲できない！ 手番をスキップします');
      endOfTurnHooks(room, p);
      continue;
    }
    if (unrevealed(room, p.id).length === 0) {
      addLog(room, p.name + ' は残弾がないため手番をスキップします');
      endOfTurnHooks(room, p);
      continue;
    }
    room.turnId = p.id;
    return;
  }
  if (room.finalRound) gameOver(room); else endRound(room); // 誰も発砲できない場合の安全策
}

function endRound(room) {
  const remaining = remainingPlayers(room);
  addLog(room, 'ラウンド' + room.round + ' 終了。残ったのは '
    + (remaining.length ? remaining.map((p) => p.name).join('・') : 'なし') + ' です');
  // 表彰用にこのラウンドの結果を記録（勝者＝最後まで残ったプレイヤー、
  // 完走者＝実弾に当たらず自分の弾を全て撃ち切ったプレイヤー）
  room.lastRoundResult = {
    round: room.round,
    winners: remaining.map((p) => ({ id: p.id, name: p.name })),
    finishers: room.players
      .filter((p) => room.roundCleared.has(p.id))
      .map((p) => ({ id: p.id, name: p.name, shots: room.roundShots.get(p.id) || 0 })),
  };
  if (room.lastRoundResult.finishers.length) {
    addLog(room, '🎯 ラウンド' + room.round + ' で全弾を無事に撃ち切ったのは '
      + room.lastRoundResult.finishers.map((f) => f.name).join('・') + ' です');
  }
  room.round += 1;
  startRound(room);
}

function gameOver(room) {
  room.phase = 'gameover';
  room.turnId = null;
  room.pending = null;
  // 最終ラウンドの結果も記録しておく（表彰データの整合のため）
  room.lastRoundResult = {
    round: room.round,
    winners: remainingPlayers(room).map((p) => ({ id: p.id, name: p.name })),
    finishers: room.players
      .filter((p) => room.roundCleared.has(p.id))
      .map((p) => ({ id: p.id, name: p.name, shots: room.roundShots.get(p.id) || 0 })),
  };
  const max = Math.max(...room.players.map((p) => p.lives));
  room.winners = room.players.filter((p) => p.lives === max)
    .map((p) => ({ id: p.id, name: p.name, lives: p.lives }));
  addLog(room, 'ゲーム終了！ 優勝は ' + room.winners.map((w) => w.name).join('・') + ' です');
}

// ===== 実弾の解決（フィールド効果・不死身・宝の持ち腐れ保留を反映） =====
function resolveLive(room, shooter, done) {
  const victims = [];
  const exclude = new Set([shooter.id]);
  if (room.fieldRule) {
    const n1 = nextRemainingId(room, shooter.id, exclude);
    if (n1) {
      victims.push(n1); exclude.add(n1);
      if (room.fieldPower) {
        const n2 = nextRemainingId(room, n1, exclude);
        if (n2) victims.push(n2);
      }
    }
    if (!victims.length) victims.push(shooter.id); // 自分以外残っていない場合は自分
  } else {
    victims.push(shooter.id);
    if (room.fieldPower) {
      const n1 = nextRemainingId(room, shooter.id, exclude);
      if (n1) victims.push(n1);
    }
  }
  if (room.fieldRule && victims[0] !== shooter.id) {
    addLog(room, '「私がルール」で実弾は次のプレイヤーを撃つ！');
  }
  if (room.fieldPower) addLog(room, '「圧倒的なパワー」で実弾が貫通する！');

  const eliminated = [];
  for (const vid of victims) {
    const v = playerOf(room, vid);
    if (!v || room.out.has(vid)) continue;
    if (v.invincible) {
      addLog(room, v.name + ' は不死身で実弾を無効化した！');
      continue;
    }
    v.lives -= 1;
    room.out.add(vid);
    eliminated.push(vid);
    addLog(room, v.name + ' が脱落！ 残機 ' + v.lives);
  }
  // 残機0が出ても即終了はしない。そのラウンドを最終ラウンドとして続行する
  updateFinalRound(room);
  // 宝の持ち腐れの保留キュー: 脱落のたびに発動順に1件ずつ処理
  for (const eid of eliminated) {
    while (room.treasureQueue.length) {
      const entry = room.treasureQueue.shift();
      if (entry.playerId === eid) continue; // 自分自身との交換はしない
      swapSuffixes(room, entry.playerId, eid);
      addLog(room, '「宝の持ち腐れ」保留解決: ' + nameOf(room, entry.playerId)
        + ' は脱落した ' + nameOf(room, eid) + ' と残弾を全て交換した');
      break;
    }
  }
  done();
}

// 1発撃つ（催眠の即時発砲でも使う）。done は効果解決まで全て終わったら呼ばれる
// anim は本人の通常の発砲リクエスト経由のときだけ渡される演出種別。
// 催眠の即時発砲など、それ以外の経路では未指定 → 'normal'（レア演出は付けない）
function fireShot(room, shooter, depth, done, anim) {
  const card = unrevealed(room, shooter.id)[0];
  if (!card) {
    addLog(room, shooter.name + ' は発砲する弾がなかった');
    done();
    return;
  }
  card.revealed = true;
  // 発砲エフェクト用イベントを予約（sendAll が state の直後に1回だけ配信する）
  room.shotQueue.push({ playerId: shooter.id, name: shooter.name, type: card.type, anim: validAnim(anim) });
  // 表彰用の追跡（公開情報のみ）: 発砲数を数え、最後の1発を撃って
  // 脱落しなかったプレイヤーを「全弾撃ち切り」として記録する
  room.roundShots.set(shooter.id, (room.roundShots.get(shooter.id) || 0) + 1);
  const firedLast = unrevealed(room, shooter.id).length === 0;
  const trackedDone = () => {
    if (firedLast && !room.out.has(shooter.id) && !room.roundCleared.has(shooter.id)) {
      room.roundCleared.add(shooter.id);
      addLog(room, '🎯 ' + shooter.name + ' は自分の弾を全て無事に撃ち切った！');
    }
    done();
  };
  addLog(room, shooter.name + ' が発砲： '
    + (card.ownerId !== shooter.id ? nameOf(room, card.ownerId) + ' の ' : '')
    + '「' + label(card.type) + '」を公開');
  if (card.type === 'live') { resolveLive(room, shooter, trackedDone); return; }
  resolveEffect(room, shooter, card.type, depth, trackedDone, { excludeUid: card.uid });
}

// ===== 効果解決のサブフェイズ（pending） =====
// 発砲→公開→（入力が必要なら pending で関係プレイヤーの入力を待つ）→次の手番へ。
// pending.resume は「この効果が終わったら続ける処理」を保持する。
function setPending(room, p) {
  room.pending = p;
  settleAuto(room);
}
// 切断中のプレイヤーが入力待ちの場合は、既定の選択で自動進行させる（ゲームを止めないため）
function settleAuto(room) {
  let guard = 0;
  while (room.pending && guard++ < 100) {
    const p = room.pending;
    const targetId = [...p.waiting].find((id) => {
      const pl = playerOf(room, id);
      return pl && !pl.connected;
    });
    if (!targetId) return;
    const payload = defaultActPayload(room, p, targetId);
    if (!payload) return;
    handleAct(room, playerOf(room, targetId), payload);
  }
}
function defaultActPayload(room, p, pid) {
  switch (p.kind) {
    case 'target': {
      const c = p.candidates.slice(0, p.count);
      if (c.length < p.count) return null;
      return p.count === 2 ? { playerIds: c } : { playerId: c[0] };
    }
    case 'uchikeshi': return { option: 'protect' };
    case 'hengen': return { fizzle: true };
    case 'dealGive': {
      const cards = unrevealed(room, pid);
      return { giveNext: cards[0] ? cards[0].uid : null, givePrev: cards[1] ? cards[1].uid : null };
    }
    case 'unmeiGive': {
      const n = p.need.get(pid) || 0;
      return { uids: unrevealed(room, pid).slice(0, n).map((c) => c.uid) };
    }
    case 'stealPick': {
      const fromId = p.pair[0] === pid ? p.pair[1] : p.pair[0];
      const cards = unrevealed(room, fromId);
      return cards.length ? { uid: cards[0].uid } : null;
    }
    case 'place': return { index: unrevealed(room, pid).length };
    case 'rotate': return { rotation: 0 };
    default: return null;
  }
}
function errTo(room, playerId, msg) {
  const sock = room.sockets.get(playerId);
  if (sock) sock.emit('errorMessage', msg);
}

// 対象候補: ラウンド残存者。打ち消し保護中のプレイヤーは他人からは選べない（自分は選べる）
function candidatesFor(room, actor, purpose) {
  return remainingPlayers(room)
    .filter((p) => !(p.protFlag && p.id !== actor.id))
    .filter((p) => purpose !== 'ubaiai' || unrevealed(room, p.id).length > 0)
    .map((p) => p.id);
}
function uchikeshiOptions(room) {
  const opts = [{ key: 'protect' }];
  if (room.fieldPower) opts.push({ key: 'cancelField', field: 'power' });
  if (room.fieldRule) opts.push({ key: 'cancelField', field: 'rule' });
  for (const p of room.players) {
    if (p.invincible) opts.push({ key: 'cancelFujimi', playerId: p.id, name: p.name });
  }
  return opts;
}
// 変幻の候補: このラウンドで公開された弾（今撃った変幻自身は除く）。公開情報のみ
function hengenCandidates(room, excludeUid) {
  const list = [];
  for (const p of room.players) {
    for (const c of rowOf(room, p.id)) {
      if (c.revealed && c.uid !== excludeUid) {
        list.push({ uid: c.uid, type: c.type, ownerId: c.ownerId, firedBy: p.id });
      }
    }
  }
  return list;
}

function pendingFor(room, viewerId) {
  const p = room.pending;
  if (!p) return null;
  return {
    kind: p.kind,
    cardType: p.cardType,
    actorId: p.actorId,
    actorName: p.actorId ? nameOf(room, p.actorId) : '',
    waitingNames: [...p.waiting].map((id) => nameOf(room, id)),
    myTask: p.waiting.has(viewerId) ? taskFor(room, p, viewerId) : null,
  };
}
function unrevealedView(room, pid, viewerId) {
  return unrevealed(room, pid).map((c) => ({ uid: c.uid, mine: c.ownerId === viewerId, ...ownerView(room, c) }));
}
function taskFor(room, p, viewerId) {
  switch (p.kind) {
    case 'target':
      return { kind: 'target', count: p.count, purpose: p.purpose,
        candidates: p.candidates.map((id) => ({ id, name: nameOf(room, id) })) };
    case 'uchikeshi':
      return { kind: 'uchikeshi', options: uchikeshiOptions(room) };
    case 'hengen':
      return { kind: 'hengen', options: hengenCandidates(room, p.excludeUid)
        .map((c) => ({ uid: c.uid, type: c.type, byName: nameOf(room, c.firedBy), ownerName: nameOf(room, c.ownerId) })) };
    case 'dealGive': {
      const nb = p.neighbor.get(viewerId);
      return { kind: 'dealGive', nextName: nameOf(room, nb.next), prevName: nameOf(room, nb.prev),
        cards: unrevealedView(room, viewerId, viewerId) };
    }
    case 'unmeiGive':
      return { kind: 'unmeiGive', count: p.need.get(viewerId) || 0, cards: unrevealedView(room, viewerId, viewerId) };
    case 'stealPick': {
      const fromId = p.pair[0] === viewerId ? p.pair[1] : p.pair[0];
      return { kind: 'stealPick', fromId, fromName: nameOf(room, fromId), cards: unrevealedView(room, fromId, viewerId) };
    }
    case 'place':
      return { kind: 'place',
        inbox: (p.inbox.get(viewerId) || []).map((c) => ({ uid: c.uid, mine: c.ownerId === viewerId, ...ownerView(room, c) })),
        count: unrevealed(room, viewerId).length };
    case 'rotate':
      return { kind: 'rotate', count: unrevealed(room, viewerId).length };
    default: return null;
  }
}

// ===== カード効果の解決 =====
function resolveEffect(room, actor, type, depth, done, opts = {}) {
  switch (type) {
    case 'reverse':
      room.direction *= -1;
      addLog(room, '「リバース」: プレイ順が反対周りになった');
      done(); return;
    case 'power':
      room.fieldPower = true;
      addLog(room, '「圧倒的なパワー」発動！ このラウンド中、実弾は次のプレイヤーまで貫通する');
      done(); return;
    case 'rule':
      room.fieldRule = true;
      addLog(room, '「私がルール」発動！ このラウンド中、実弾は次のプレイヤーを撃つ');
      done(); return;
    case 'fujimi':
      actor.invincible = true;
      actor.invJustSet = true;
      addLog(room, actor.name + ' は「不死身」になった（次の自分の手番終了時まで実弾を無効化）');
      done(); return;
    case 'takara':
      takaraResolve(room, actor, done); return;
    case 'uchikeshi':
      setPending(room, { kind: 'uchikeshi', cardType: 'uchikeshi', actorId: actor.id,
        waiting: new Set([actor.id]), resume: done });
      return;
    case 'hengen':
      openHengen(room, actor, depth, 0, done, opts.excludeUid);
      return;
    case 'amanojaku': case 'usagi': case 'mosaic':
    case 'damazumari': case 'nusumimi': case 'saimin':
      setPending(room, { kind: 'target', purpose: type, count: 1, cardType: type,
        actorId: actor.id, depth, candidates: candidatesFor(room, actor, type),
        waiting: new Set([actor.id]), resume: done });
      return;
    case 'kurayami': case 'ubaiai':
      setPending(room, { kind: 'target', purpose: type, count: 2, cardType: type,
        actorId: actor.id, depth, candidates: candidatesFor(room, actor, type),
        waiting: new Set([actor.id]), resume: done });
      return;
    case 'deal':
      startDeal(room, actor, done); return;
    case 'unmei':
      startUnmei(room, actor, done); return;
    default:
      done(); return;
  }
}

function openHengen(room, actor, depth, hengenDepth, done, excludeUid) {
  if (!hengenCandidates(room, excludeUid).length) {
    addLog(room, '「変幻」: 使用済みの弾がなく不発');
    done();
    return;
  }
  setPending(room, { kind: 'hengen', cardType: 'hengen', actorId: actor.id, depth, hengenDepth,
    excludeUid, waiting: new Set([actor.id]), resume: done });
}
function resolveHengenChoice(room, p, chosen) {
  const actor = playerOf(room, p.actorId);
  const resume = p.resume;
  room.pending = null;
  const t = chosen.type;
  if (t === 'hengen') {
    if (p.hengenDepth >= 1) {
      addLog(room, '「変幻」: これ以上コピーは重ねられず不発');
      resume();
      return;
    }
    openHengen(room, actor, p.depth, p.hengenDepth + 1, resume, p.excludeUid);
    return;
  }
  addLog(room, actor.name + ' の「変幻」: 「' + label(t) + '」の効果をコピーした');
  if (t === 'power' || t === 'rule') {
    addLog(room, 'フィールド効果のコピーは何も起きない');
    resume();
    return;
  }
  if (t === 'live') { resolveLive(room, actor, resume); return; }
  resolveEffect(room, actor, t, p.depth, resume, { viaHengen: true });
}

function takaraResolve(room, actor, done) {
  const outs = room.players.filter((p) => room.out.has(p.id));
  if (!outs.length) {
    room.treasureQueue.push({ playerId: actor.id });
    addLog(room, actor.name + ' の「宝の持ち腐れ」: 脱落者がいないため保留（最初に脱落したプレイヤーと交換）');
    done();
    return;
  }
  if (outs.length === 1) {
    swapSuffixes(room, actor.id, outs[0].id);
    addLog(room, actor.name + ' の「宝の持ち腐れ」: 脱落した ' + outs[0].name + ' と残弾を全て交換した');
    done();
    return;
  }
  setPending(room, { kind: 'target', purpose: 'takara', count: 1, cardType: 'takara',
    actorId: actor.id, depth: 0, candidates: outs.map((p) => p.id),
    waiting: new Set([actor.id]), resume: done });
}

function startDeal(room, actor, done) {
  const parts = remainingPlayers(room);
  const neighbor = new Map();
  parts.forEach((p, i) => {
    neighbor.set(p.id, {
      next: parts[(i + 1) % parts.length].id,
      prev: parts[(i - 1 + parts.length) % parts.length].id,
    });
  });
  const waiting = new Set(parts.filter((p) => unrevealed(room, p.id).length > 0).map((p) => p.id));
  if (!waiting.size) { addLog(room, '「裏取引」: 渡せる弾がなく不発'); done(); return; }
  addLog(room, '「裏取引」: ラウンド残存者全員が、両隣に弾を1発ずつ渡す');
  setPending(room, { kind: 'dealGive', cardType: 'deal', actorId: actor.id,
    participants: parts.map((p) => p.id), neighbor, gives: new Map(), waiting, resume: done });
}
function finishDealGive(room, p) {
  const resume = p.resume;
  room.pending = null;
  const inbox = new Map(p.participants.map((id) => [id, []]));
  for (const pid of p.participants) {
    const g = p.gives.get(pid) || { next: null, prev: null };
    const nb = p.neighbor.get(pid);
    if (g.next) { const c = removeByUid(room, pid, g.next); if (c) inbox.get(nb.next).push(c); }
    if (g.prev) { const c = removeByUid(room, pid, g.prev); if (c) inbox.get(nb.prev).push(c); }
  }
  addLog(room, '「裏取引」: 弾が一斉に渡された。受け取った弾を装填してください');
  startPlace(room, inbox, resume, 'deal');
}
function startUnmei(room, actor, done) {
  const parts = remainingPlayers(room);
  const need = new Map();
  const waiting = new Set();
  for (const p of parts) {
    const n = Math.min(2, unrevealed(room, p.id).length);
    need.set(p.id, n);
    if (n > 0) waiting.add(p.id);
  }
  if (!waiting.size) { addLog(room, '「運命」: 対象の弾がなく不発'); done(); return; }
  addLog(room, '「運命」: 全員が弾を最大2発ずつ出し合い、シャッフルして配り直す');
  setPending(room, { kind: 'unmeiGive', cardType: 'unmei', actorId: actor.id,
    participants: parts.map((p) => p.id), need, picks: new Map(), waiting, resume: done });
}
function finishUnmeiGive(room, p) {
  const resume = p.resume;
  room.pending = null;
  const pool = [];
  for (const pid of p.participants) {
    for (const uid of (p.picks.get(pid) || [])) {
      const c = removeByUid(room, pid, uid);
      if (c) pool.push(c);
    }
  }
  shuffle(pool);
  const inbox = new Map();
  for (const pid of p.participants) inbox.set(pid, pool.splice(0, p.need.get(pid) || 0));
  addLog(room, '「運命」: 弾が配り直された。受け取った弾を装填してください');
  startPlace(room, inbox, resume, 'unmei');
}
// 受け取り弾の装填フェイズ（裏取引・運命・奪い合いで共用）
function startPlace(room, inbox, resume, displayType) {
  const waiting = new Set([...inbox.entries()].filter(([, arr]) => arr.length > 0).map(([id]) => id));
  if (!waiting.size) { resume(); return; }
  setPending(room, { kind: 'place', cardType: displayType || 'place', actorId: null, inbox, waiting, resume });
}

// 対象選択が終わったあとの効果適用
function applyTargetEffect(room, p, targets) {
  const actor = playerOf(room, p.actorId);
  const resume = p.resume;
  room.pending = null;
  const t0 = targets[0];
  switch (p.purpose) {
    case 'amanojaku':
      reverseSuffix(room, t0);
      addLog(room, '「天邪鬼」: ' + nameOf(room, t0) + ' の残弾の順序が反転した');
      resume(); return;
    case 'usagi':
      rotateSuffix(room, t0, 1);
      addLog(room, '「ウサギ跳び」: ' + nameOf(room, t0) + ' の弾倉が1つ回転した');
      resume(); return;
    case 'mosaic':
      shuffleSuffix(room, t0);
      addLog(room, '「ランダムモザイク」: ' + nameOf(room, t0) + ' の残弾がシャッフルされた');
      resume(); return;
    case 'damazumari': {
      const t = playerOf(room, t0);
      if (t) t.jammed = true;
      addLog(room, '「弾詰まり」: ' + nameOf(room, t0) + ' は次の手番で発砲できない');
      resume(); return;
    }
    case 'nusumimi': {
      const types = unrevealed(room, t0).map((c) => c.type);
      const notes = room.peekNotes.get(actor.id) || [];
      notes.push({ targetId: t0, targetName: nameOf(room, t0), types });
      room.peekNotes.set(actor.id, notes);
      addLog(room, actor.name + ' は「盗み見」で ' + nameOf(room, t0) + ' の残弾をのぞき見た');
      resume(); return;
    }
    case 'saimin': {
      const t = playerOf(room, t0);
      if (p.depth >= CONFIG.maxSaiminDepth) {
        addLog(room, '「催眠」: 重なりすぎて不発');
        resume(); return;
      }
      addLog(room, '「催眠」: ' + nameOf(room, t0) + ' が即座に発砲する');
      fireShot(room, t, p.depth + 1, resume);
      return;
    }
    case 'takara':
      swapSuffixes(room, actor.id, t0);
      addLog(room, actor.name + ' の「宝の持ち腐れ」: 脱落した ' + nameOf(room, t0) + ' と残弾を全て交換した');
      resume(); return;
    case 'kurayami':
      swapSuffixes(room, targets[0], targets[1]);
      addLog(room, '「暗闇」: ' + nameOf(room, targets[0]) + ' と ' + nameOf(room, targets[1])
        + ' の残弾が全て交換された。2人は弾倉を好きなだけ回転できる');
      setPending(room, { kind: 'rotate', cardType: 'kurayami', actorId: actor.id,
        pair: targets, waiting: new Set(targets), resume });
      return;
    case 'ubaiai': {
      if (!unrevealed(room, targets[0]).length || !unrevealed(room, targets[1]).length) {
        addLog(room, '「奪い合い」: 対象の残弾がなく不発');
        resume(); return;
      }
      addLog(room, '「奪い合い」: ' + nameOf(room, targets[0]) + ' と ' + nameOf(room, targets[1])
        + ' が互いの弾を1発ずつ選ぶ');
      setPending(room, { kind: 'stealPick', cardType: 'ubaiai', actorId: actor.id,
        pair: targets, picks: new Map(), waiting: new Set(targets), resume });
      return;
    }
    default:
      resume(); return;
  }
}

// プレイヤーの入力（act）を処理する
function handleAct(room, player, payload) {
  const p = room.pending;
  if (!p || !player || !p.waiting.has(player.id)) return;
  payload = payload || {};
  switch (p.kind) {
    case 'target': {
      let ids = Array.isArray(payload.playerIds) ? payload.playerIds.slice()
        : (payload.playerId ? [payload.playerId] : []);
      ids = ids.filter((v, i) => ids.indexOf(v) === i);
      if (ids.length !== p.count) { errTo(room, player.id, '対象を ' + p.count + ' 人選んでください'); return; }
      if (ids.some((id) => !p.candidates.includes(id))) { errTo(room, player.id, 'そのプレイヤーは選べません'); return; }
      applyTargetEffect(room, p, ids);
      return;
    }
    case 'uchikeshi': {
      if (payload.option === 'protect') {
        player.protFlag = true;
        addLog(room, player.name + ' は「打ち消し」で身を守った（次の自分の手番開始時まで、他の効果の対象に選ばれない）');
      } else if (payload.option === 'cancelField' && payload.field === 'power' && room.fieldPower) {
        room.fieldPower = false;
        addLog(room, player.name + ' の「打ち消し」: 「圧倒的なパワー」を打ち消した');
      } else if (payload.option === 'cancelField' && payload.field === 'rule' && room.fieldRule) {
        room.fieldRule = false;
        addLog(room, player.name + ' の「打ち消し」: 「私がルール」を打ち消した');
      } else if (payload.option === 'cancelFujimi') {
        const t = playerOf(room, payload.playerId);
        if (!t || !t.invincible) { errTo(room, player.id, 'その不死身は発動していません'); return; }
        t.invincible = false;
        t.invJustSet = false;
        addLog(room, player.name + ' の「打ち消し」: ' + t.name + ' の「不死身」を打ち消した');
      } else { errTo(room, player.id, '選択が正しくありません'); return; }
      const resume = p.resume; room.pending = null; resume();
      return;
    }
    case 'hengen': {
      if (payload.fizzle) {
        const resume = p.resume; room.pending = null;
        addLog(room, '「変幻」は不発に終わった');
        resume(); return;
      }
      const cand = hengenCandidates(room, p.excludeUid).find((c) => c.uid === payload.uid);
      if (!cand) { errTo(room, player.id, 'その弾は選べません'); return; }
      resolveHengenChoice(room, p, cand);
      return;
    }
    case 'dealGive': {
      const cards = unrevealed(room, player.id);
      const byUid = new Map(cards.map((c) => [c.uid, c]));
      const gn = payload.giveNext || null;
      const gp = payload.givePrev || null;
      if ((gn && !byUid.has(gn)) || (gp && !byUid.has(gp))) { errTo(room, player.id, 'その弾は渡せません'); return; }
      if (gn && gp && gn === gp) { errTo(room, player.id, '同じ弾は2回選べません'); return; }
      const need = Math.min(2, cards.length);
      if ((gn ? 1 : 0) + (gp ? 1 : 0) !== need) { errTo(room, player.id, '渡す弾を ' + need + ' 発選んでください'); return; }
      p.gives.set(player.id, { next: gn, prev: gp });
      p.waiting.delete(player.id);
      addLog(room, player.name + ' は渡す弾を選んだ');
      if (!p.waiting.size) finishDealGive(room, p);
      return;
    }
    case 'unmeiGive': {
      const n = p.need.get(player.id) || 0;
      const uids = Array.isArray(payload.uids) ? payload.uids : [];
      const byUid = new Map(unrevealed(room, player.id).map((c) => [c.uid, c]));
      if (uids.length !== n || new Set(uids).size !== uids.length || uids.some((u) => !byUid.has(u))) {
        errTo(room, player.id, '弾を ' + n + ' 発選んでください'); return;
      }
      p.picks.set(player.id, uids.slice());
      p.waiting.delete(player.id);
      addLog(room, player.name + ' は出す弾を選んだ');
      if (!p.waiting.size) finishUnmeiGive(room, p);
      return;
    }
    case 'stealPick': {
      const fromId = p.pair[0] === player.id ? p.pair[1] : p.pair[0];
      const card = unrevealed(room, fromId).find((c) => c.uid === payload.uid);
      if (!card) { errTo(room, player.id, 'その弾は選べません'); return; }
      p.picks.set(player.id, payload.uid);
      p.waiting.delete(player.id);
      addLog(room, player.name + ' は奪う弾を選んだ');
      if (!p.waiting.size) {
        const resume = p.resume;
        room.pending = null;
        const [a, b] = p.pair;
        const cardA = removeByUid(room, b, p.picks.get(a));
        const cardB = removeByUid(room, a, p.picks.get(b));
        const inbox = new Map([[a, cardA ? [cardA] : []], [b, cardB ? [cardB] : []]]);
        addLog(room, '「奪い合い」: ' + nameOf(room, a) + ' と ' + nameOf(room, b) + ' が弾を交換した。受け取った弾を装填してください');
        startPlace(room, inbox, resume, 'ubaiai');
      }
      return;
    }
    case 'place': {
      const inbox = p.inbox.get(player.id) || [];
      if (!inbox.length) return;
      const idx = Number(payload.index);
      if (!Number.isInteger(idx) || idx < 0 || idx > unrevealed(room, player.id).length) {
        errTo(room, player.id, '装填位置が正しくありません'); return;
      }
      const card = inbox.shift();
      insertUnrevealed(room, player.id, card, idx);
      if (!inbox.length) p.waiting.delete(player.id);
      if (!p.waiting.size) { const resume = p.resume; room.pending = null; resume(); }
      return;
    }
    case 'rotate': {
      const k = Number(payload.rotation) || 0;
      rotateSuffix(room, player.id, k);
      addLog(room, player.name + ' は弾倉を ' + k + ' つ回転させた');
      p.waiting.delete(player.id);
      if (!p.waiting.size) { const resume = p.resume; room.pending = null; resume(); }
      return;
    }
    default: return;
  }
}

// 切断したプレイヤーの自動セット（実弾＋先頭5枚）。進行が止まらないための措置。
function autoSet(room, player) {
  const hand = room.hands.get(player.id);
  if (!hand) return;
  const live = hand.filter((c) => c.type === 'live');
  const rest = hand.filter((c) => c.type !== 'live');
  room.rows.set(player.id, [...live, ...rest].slice(0, CONFIG.setSize));
  room.hands.set(player.id, null); // 余りは廃棄
  room.submitted.add(player.id);
  addLog(room, player.name + ' が切断したため、自動で装填しました');
}

function cleanName(name, fallback) {
  const n = String(name || '').trim().slice(0, 12);
  return n || fallback;
}

// テスト用リグ（本番では無効: 環境変数 DANGAN_TEST_HOOKS=1 かつ NODE_ENV!=production のときだけ）
const TEST_HOOKS = process.env.DANGAN_TEST_HOOKS === '1' && process.env.NODE_ENV !== 'production';

io.on('connection', (socket) => {
  let myRoom = null;

  function joinRoomCommon(room, role) {
    myRoom = room.code;
    room.sockets.set(socket.id, socket);
    socket.join(room.code);
    socket.emit('roomJoined', { code: room.code, role, playerId: socket.id });
    sendAll(room);
  }

  socket.on('createRoom', ({ name } = {}) => {
    if (myRoom) return;
    const code = newCode();
    const room = newRoom(code, socket.id);
    rooms.set(code, room);
    room.players.push(newPlayer(socket.id, cleanName(name, 'プレイヤー1')));
    joinRoomCommon(room, 'player');
  });

  socket.on('joinRoom', ({ code, name } = {}) => {
    if (myRoom) return;
    code = String(code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) { socket.emit('errorMessage', '部屋が見つかりません。コードを確認してください。'); return; }
    if (room.phase === 'lobby' && room.players.length < CONFIG.maxPlayers) {
      room.players.push(newPlayer(socket.id,
        cleanName(name, 'プレイヤー' + (room.players.length + 1))));
      joinRoomCommon(room, 'player');
    } else {
      joinRoomCommon(room, 'spectator');
    }
  });

  if (TEST_HOOKS) {
    // テスト用: ラウンドごとの配布を固定する（rounds[round-1][playerIndex] = 7枚のtype配列）
    socket.on('testSetRig', ({ rounds } = {}) => {
      const room = myRoom && rooms.get(myRoom);
      if (!room || room.phase !== 'lobby' || !Array.isArray(rounds)) return;
      room.rig = rounds;
    });
  }

  socket.on('startGame', () => {
    const room = myRoom && rooms.get(myRoom);
    if (!room || room.phase !== 'lobby') return;
    if (room.hostId !== socket.id) { socket.emit('errorMessage', '開始できるのはホストだけです。'); return; }
    if (room.players.length < CONFIG.minPlayers) {
      socket.emit('errorMessage', '開始には ' + CONFIG.minPlayers + ' 人以上が必要です（現在 ' + room.players.length + ' 人）。');
      return;
    }
    startGame(room);
    sendAll(room);
  });

  socket.on('submitSet', ({ uids } = {}) => {
    const room = myRoom && rooms.get(myRoom);
    if (!room || room.phase !== 'setup') return;
    const player = playerOf(room, socket.id);
    if (!player || room.submitted.has(socket.id)) return;
    const hand = room.hands.get(socket.id);
    if (!hand) return;
    if (!Array.isArray(uids) || uids.length !== CONFIG.setSize) {
      socket.emit('errorMessage', CONFIG.setSize + ' 枚ちょうど選んでください。');
      return;
    }
    if (new Set(uids).size !== uids.length) {
      socket.emit('errorMessage', '同じカードは2回選べません。');
      return;
    }
    const byUid = new Map(hand.map((c) => [c.uid, c]));
    const chosen = uids.map((u) => byUid.get(u));
    if (chosen.some((c) => !c)) {
      socket.emit('errorMessage', '手札にないカードが含まれています。');
      return;
    }
    if (!chosen.some((c) => c.type === 'live')) {
      socket.emit('errorMessage', '実弾を必ず1枚含めて装填してください。');
      return;
    }
    room.rows.set(socket.id, chosen);
    room.hands.set(socket.id, null); // 余った1枚は廃棄され、誰にも見えない
    room.submitted.add(socket.id);
    addLog(room, player.name + ' が装填完了（' + room.submitted.size + '/' + room.players.length + '）');
    if (room.submitted.size >= room.players.length) startFiring(room);
    sendAll(room);
  });

  socket.on('fire', (payload) => {
    const room = myRoom && rooms.get(myRoom);
    if (!room || room.phase !== 'firing' || room.pending) return;
    if (room.turnId !== socket.id) return;
    const player = playerOf(room, socket.id);
    if (!player || room.out.has(socket.id)) return;
    // 演出種別はホワイトリストで検証して 'shot' に転送するだけ（進行には無影響）
    const anim = validAnim(payload && payload.anim);
    fireShot(room, player, 0, () => {
      endOfTurnHooks(room, player);
      finishTurn(room);
    }, anim);
    sendAll(room);
  });

  socket.on('act', (payload) => {
    const room = myRoom && rooms.get(myRoom);
    if (!room || room.phase !== 'firing' || !room.pending) return;
    const player = playerOf(room, socket.id);
    if (!player) return;
    handleAct(room, player, payload);
    sendAll(room);
  });

  socket.on('playAgain', () => {
    const room = myRoom && rooms.get(myRoom);
    if (!room || room.phase !== 'gameover') return;
    if (room.hostId !== socket.id) { socket.emit('errorMessage', 'もう一度遊ぶを開始できるのはホストだけです。'); return; }
    startGame(room);
    sendAll(room);
  });

  socket.on('disconnect', () => {
    if (!myRoom) return;
    const room = rooms.get(myRoom);
    if (!room) return;
    room.sockets.delete(socket.id);
    const player = playerOf(room, socket.id);
    if (player) {
      player.connected = false;
      if (room.phase === 'lobby') {
        room.players = room.players.filter((p) => p.id !== socket.id);
        room.hands.delete(socket.id);
        room.rows.delete(socket.id);
        if (room.hostId === socket.id && room.players.length) room.hostId = room.players[0].id;
      } else if (room.phase === 'setup' && !room.submitted.has(socket.id)) {
        autoSet(room, player);
        if (room.submitted.size >= room.players.length) startFiring(room);
      }
      // 効果解決の入力待ちだった場合は、既定の選択で自動進行させる
      if (room.pending) settleAuto(room);
      if (room.phase === 'firing' && !room.pending && room.turnId === socket.id) {
        if (!checkEnd(room)) setNextTurn(room);
      }
    }
    if (room.sockets.size === 0) rooms.delete(myRoom);
    else sendAll(room);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('超幸運ロシアンパーティ server listening on http://localhost:' + PORT));
