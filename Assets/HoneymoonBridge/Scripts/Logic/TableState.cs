using System;

namespace HoneymoonBridge
{
    // 「某一個玩家能看到的牌桌」。對手的手牌只有張數，不會傳過去 → 朋友改封包也偷看不到你的牌
    [Serializable]
    public class TableState
    {
        public int seat;                 // 我坐哪（0 或 1）
        public int phase;                // (int)Phase
        public int[] hand = new int[0];
        public int[] legal = new int[0]; // 現在能出的牌；不是我的回合就是空的
        public int oppCount;
        public int faceUp = -1;
        public int stockCount;
        public int leadCard = -1, followCard = -1;
        public int leaderSeat, currentSeat;
        public int myTricks, oppTricks;
        public int[] oppTakenFaceUp = new int[0];   // 記牌小抄

        // ---- 叫牌 ----
        public int highestBid = -1, highestBidder = -1, declarer = -1, minBid;
        public int doubled;                          // 0 / 1 加倍 / 2 再加倍
        public bool canDouble, canRedouble;          // 只有輪到我叫、而且可以的時候才是 true
        public int[] auctionSeats = new int[0];      // 叫牌紀錄：第 i 筆是誰叫的
        public int[] auctionCalls = new int[0];      //           叫了什麼（Call 編碼）

        // ---- 計分 ----
        public int myScore, oppScore, targetScore;
        public int handNumber;                       // 第幾局
        public bool hasResult;                       // 這局打完了，result 有內容
        public HandResult result = new HandResult();
        public int matchWinner = -1;                 // 整場贏家；-1 = 還沒結束

        public Phase Phase => (Phase)phase;
        public bool TrickComplete => leadCard >= 0 && followCard >= 0;
        // 兩張牌都上桌、等結算的那一下不算你的回合
        public bool IsMyTurn => currentSeat == seat && !TrickComplete;
        public bool MatchOver => matchWinner >= 0;
    }
}
