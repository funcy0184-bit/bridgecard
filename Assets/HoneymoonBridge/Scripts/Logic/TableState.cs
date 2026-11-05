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
        public int highestBid = -1, highestBidder = -1, declarer = -1, minBid;
        public int[] oppTakenFaceUp = new int[0];   // 記牌小抄

        public Phase Phase => (Phase)phase;
        public bool TrickComplete => leadCard >= 0 && followCard >= 0;
        // 兩張牌都上桌、等結算的那一下不算你的回合
        public bool IsMyTurn => currentSeat == seat && !TrickComplete;
    }
}
