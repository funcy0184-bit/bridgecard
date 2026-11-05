using TMPro;
using UnityEngine;

namespace HoneymoonBridge.Tutorial
{
    // 牌桌上的「白話提示」框：跟著牌桌狀態更新，內容由 BidCoach（純 C#）產生
    public class CoachPanel : MonoBehaviour
    {
        [SerializeField] GameObject root;
        [SerializeField] TMP_Text body;

        ITableClient table;
        TableState last;
        TutorialSettings settings;
        bool wanted;   // 這個模式要不要提示（章節關卡有自己的說明，就不用）

        public void Init(TutorialSettings s)
        {
            settings = s;
            root.SetActive(false);
        }

        public void Bind(ITableClient t, bool showHints)
        {
            if (table != null) table.StateChanged -= OnState;
            table = t;
            wanted = showHints;
            last = null;
            if (table != null) table.StateChanged += OnState;
            Refresh();
        }

        void OnState(TableState st)
        {
            last = st;
            Refresh();
        }

        public void Refresh()
        {
            string msg = wanted && table != null && settings != null && settings.Hints ? BidCoach.For(last, table.OppName) : null;
            bool show = !string.IsNullOrEmpty(msg);
            root.SetActive(show);
            if (show) body.text = "<b>白話提示</b>\n" + msg;
        }
    }
}
