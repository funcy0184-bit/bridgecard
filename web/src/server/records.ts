// 同桌戰績與精彩回顧（純函式：不碰網路、不碰儲存）
//   · 戰績只算「確認打完或照正式規則結算」的場次；同一場只會有一筆（場次編號是主鍵）
//   · 回顧只用公開事件（雙方都看得到的出牌、明牌、叫牌、結果）；摸到的暗牌、非法出牌提示一律不用
import type { GameEvent } from "../game/game";
import { bidText, cardText, tricksNeeded } from "../game/cards";
import type { Highlight, MatchRecord, PairStats } from "./protocol";

export interface RecordRow extends MatchRecord { pids: [string, string] }
export interface LoggedEvent { eid: number; to: number; e: GameEvent }

// 只算現在這兩個人（座位上的人換了，就是另一組同桌）
export function pairStats(rows: RecordRow[], pids: [string | null, string | null]): PairStats {
  const mine = rows.filter(r => r.pids[0] === pids[0] && r.pids[1] === pids[1]).sort((a, b) => a.at - b.at);
  const wins: [number, number] = [0, 0];
  for (const r of mine) wins[r.winner]++;
  let streak: PairStats["streak"] = null;
  for (let i = mine.length - 1; i >= 0; i--) {
    if (!streak) streak = { seat: mine[i].winner, n: 1 };
    else if (mine[i].winner === streak.seat) streak.n++;
    else break;
  }
  return { played: mine.length, wins, draws: 0, streak, last: mine.slice(-5).reverse().map(({ pids: _p, ...r }) => r) };
}

// 公開事件：發給兩邊的（to = -1），而且不是「摸暗牌」「非法出牌」這種私人提示
export const isPublic = (x: LoggedEvent) => x.to < 0 && x.e.type !== "CardDrawn" && x.e.type !== "Illegal";

// 從公開事件整理精彩回顧（第一版：文字＋兩張牌）
export function highlights(log: LoggedEvent[], names: [string, string]): Highlight[] {
  const ev = log.filter(isPublic).map(x => x.e);
  const out: Highlight[] = [];
  const nm = (s: number) => names[s] ?? (s === 0 ? "房主" : "朋友");
  let hand = 0, inPlay = false, trick: GameEvent[] = [];
  let contract: GameEvent | null = null;
  const declTricks = [0, 0];
  let decider: Highlight | null = null;
  const ruffs: Highlight[] = [];
  let biggest: { hand: number; seat: number; pts: number } | null = null;
  let lastScore: { hand: number; seat: number; pts: number } | null = null;
  for (const e of ev) {
    switch (e.type) {
      case "NewHand": hand = e.value; inPlay = false; trick = []; contract = null; declTricks[0] = declTricks[1] = 0; break;
      case "ContractSet": contract = e; inPlay = true; trick = []; break;
      case "CardPlayed": trick.push(e); if (trick.length > 2) trick = trick.slice(-2); break;
      case "TrickWon": {
        if (!inPlay || trick.length < 2 || !contract) { trick = []; break; }
        const [a, b] = trick;
        const lose = a.seat === e.seat ? b : a, win = a.seat === e.seat ? a : b;
        if (e.extra === 1) ruffs.push({ kind: "ruff", hand, text: `第 ${hand} 局：${nm(e.seat)}用 ${cardText(win.card)} 王吃了${nm(lose.seat)}的 ${cardText(lose.card)}。`, cards: [a.card, b.card], seats: [a.seat, b.seat] });
        // 這一墩讓合約定案（莊家剛好拿到目標墩數，或防守方剛好把合約打倒）
        const need = tricksNeeded(contract.value), decl = contract.seat;
        declTricks[e.seat === decl ? 0 : 1]++;
        if ((e.seat === decl && declTricks[0] === need) || (e.seat !== decl && declTricks[1] === 14 - need))
          decider = { kind: "decider", hand, text: `第 ${hand} 局的關鍵墩：${nm(e.seat)}的 ${cardText(win.card)} 拿下這墩，${e.seat === decl ? `${nm(decl)}的 ${bidText(contract.value)} 確定打成` : `${nm(decl)}的 ${bidText(contract.value)} 確定倒約`}。`, cards: [a.card, b.card], seats: [a.seat, b.seat] };
        trick = [];
        break;
      }
      case "GameOver": {
        if (contract && contract.extra > 0) {
          const made = e.value >= e.extra;
          const dbl = contract.extra >= 2 ? "再加倍" : "加倍";
          out.push({ kind: made ? "doubleMade" : "doubleDown", hand, text: made
            ? `第 ${hand} 局：${nm(e.seat)}的 ${bidText(contract.value)} 被${dbl}還是打成（${e.value} 墩）。`
            : `第 ${hand} 局：${nm(e.seat)}的 ${bidText(contract.value)} 被${dbl}，倒了 ${e.extra - e.value} 墩。` });
        }
        break;
      }
      case "HandScored":
        lastScore = { hand, seat: e.seat, pts: e.value };
        if (!biggest || e.value > biggest.pts) biggest = { hand, seat: e.seat, pts: e.value };
        break;
      case "MatchOver":
        if (lastScore) out.push({ kind: "matchPoint", hand: lastScore.hand, text: `決勝的一局：第 ${lastScore.hand} 局${nm(lastScore.seat)}拿 ${lastScore.pts} 分，以 ${e.value} 比 ${e.extra} 拿下整場。` });
        break;
    }
  }
  if (biggest) out.push({ kind: "bigHand", hand: biggest.hand, text: `單局最高分：第 ${biggest.hand} 局${nm(biggest.seat)}拿 ${biggest.pts} 分。` });
  if (decider) out.push(decider);
  out.push(...ruffs.slice(-2));
  return out.sort((a, b) => a.hand - b.hand);
}
