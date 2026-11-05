using UnityEngine;

namespace HoneymoonBridge
{
    // 「回饋導演」：每個遊戲事件該跳什麼字、震不震畫面，全部集中在這裡調。
    // 想改手感只要動這支，不用碰遊戲邏輯
    public class FeedbackDirector : MonoBehaviour
    {
        [SerializeField] FloatingText floatingPrefab;
        [SerializeField] RectTransform fxLayer;        // 最上層、不擋點擊的空物件
        [SerializeField] RectTransform shakeRoot;      // 震畫面時要晃的根物件（整個牌桌）
        [SerializeField] RectTransform myAnchor;       // 我這側跳字的位置
        [SerializeField] RectTransform oppAnchor;      // 對手那側
        [SerializeField] RectTransform centerAnchor;   // 畫面中央大字

        [Header("配色")]
        [SerializeField] Color good = new Color(0.18f, 0.55f, 0.31f);
        [SerializeField] Color bad = new Color(0.72f, 0.14f, 0.23f);
        [SerializeField] Color gold = new Color(0.85f, 0.6f, 0.15f);
        [SerializeField] Color ink = new Color(0.11f, 0.16f, 0.23f);
        [SerializeField] Color muted = new Color(0.45f, 0.5f, 0.52f);

        public void Popup(string content, RectTransform at, Color color, float size = 44f,
                          TextFXFlags flags = TextFXFlags.PopIn, float hold = 0.7f)
        {
            var ft = Instantiate(floatingPrefab, fxLayer);
            ft.transform.position = at.position;
            StartCoroutine(ft.Show(content, color, size, flags, hold));
        }

        public void ShakeScreen(float amplitude = 12f, float dur = 0.25f)
        {
            if (shakeRoot) StartCoroutine(Tween.Shake(shakeRoot, amplitude, dur));
        }

        public void IllegalMove() =>
            Popup("要先跟同花色！", myAnchor, bad, 36f, TextFXFlags.Shake, 0.6f);

        // before = 事件發生「之前」的牌桌（用來判斷合約是否剛好達成）
        public void Handle(GameEvent e, TableState before, int mySeat, string oppName)
        {
            bool me = e.seat == mySeat;
            var side = me ? myAnchor : oppAnchor;

            switch (e.type)
            {
                case GameEventType.NewHand:
                    Popup("發牌！", centerAnchor, ink, 64f, TextFXFlags.PopIn, 0.6f);
                    break;

                case GameEventType.CardPlayed when e.extra == 1:
                    // 王吃：整場最爽的瞬間，給最大的回饋
                    Popup("王吃！", side, gold, 72f, TextFXFlags.PopIn | TextFXFlags.Shake, 0.8f);
                    ShakeScreen(16f, 0.3f);
                    break;

                case GameEventType.TrickWon when e.value >= 0:
                    Popup(me ? "+1 墩" : $"{oppName} +1", side, me ? good : muted, 40f);
                    if (before != null && before.declarer == e.seat && before.highestBid >= 0
                        && e.value == Bid.FromIndex(before.highestBid).TricksNeeded)
                    {
                        Popup(me ? "合約達成！" : $"{oppName}的合約達成了", centerAnchor,
                              me ? gold : bad, 64f, TextFXFlags.PopIn | TextFXFlags.Wave, 1.2f);
                    }
                    break;

                case GameEventType.FaceUpTaken:
                {
                    var c = Card.FromId(e.card);
                    if (c.Rank < 11) break;                       // 只有 J 以上的好牌才特別提示
                    if (me) Popup($"搶到 {c.ToRichText()}！", side, gold, 48f, TextFXFlags.PopIn | TextFXFlags.Wave);
                    else Popup($"{c.ToRichText()} 被搶走", side, bad, 40f, TextFXFlags.PopIn);
                    break;
                }

                case GameEventType.DrawPhaseOver:
                    Popup("牌堆抽完 · 開始叫牌", centerAnchor, ink, 56f, TextFXFlags.PopIn | TextFXFlags.Wave, 1.1f);
                    break;

                case GameEventType.BidMade:
                {
                    bool raise = before != null && before.highestBid >= 0;   // 蓋過對方 = 加碼
                    string label = Bid.FromIndex(e.value).ToString();
                    Popup(raise ? $"加碼 {label}" : label, side, ink, 52f,
                          raise ? TextFXFlags.PopIn | TextFXFlags.Shake : TextFXFlags.PopIn);
                    break;
                }

                case GameEventType.Passed:
                    Popup("Pass", side, muted, 36f);
                    break;

                case GameEventType.ContractSet:
                {
                    var bid = Bid.FromIndex(e.value);
                    Popup($"合約 {bid}", centerAnchor, gold, 80f, TextFXFlags.PopIn | TextFXFlags.Wave, 1.4f);
                    break;
                }

                case GameEventType.GameOver:
                {
                    bool made = e.value >= e.extra;
                    bool goodForMe = me == made;    // 我是莊家且打成，或對方是莊家且倒約
                    string msg = made ? "打成！" : $"倒 {e.extra - e.value} 墩";
                    Popup(msg, centerAnchor, goodForMe ? good : bad, 110f,
                          made ? TextFXFlags.PopIn | TextFXFlags.Wave : TextFXFlags.PopIn | TextFXFlags.Shake, 2.2f);
                    ShakeScreen(goodForMe ? 10f : 18f, 0.35f);
                    break;
                }

                case GameEventType.Illegal:
                    IllegalMove();
                    break;

                case GameEventType.Redeal:
                    Popup("雙方都 Pass · 重發", centerAnchor, muted, 52f, TextFXFlags.PopIn, 1f);
                    break;
            }
        }
    }
}
