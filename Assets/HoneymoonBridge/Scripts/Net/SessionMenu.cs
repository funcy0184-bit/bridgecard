using System;
using System.Threading.Tasks;
using TMPro;
using Unity.Services.Authentication;
using Unity.Services.Core;
using Unity.Services.Multiplayer;
using UnityEngine;
using UnityEngine.UI;

namespace HoneymoonBridge
{
    // 開場選單：單機 / 開房間 / 輸入代碼加入
    public class SessionMenu : MonoBehaviour
    {
        [SerializeField] GameObject menuPanel;
        [SerializeField] Button soloButton;
        [SerializeField] Button hostButton;
        [SerializeField] Button joinButton;
        [SerializeField] TMP_InputField codeInput;
        [SerializeField] TMP_Text statusText;

        [SerializeField] GameView view;
        [SerializeField] LocalTable localTable;
        [SerializeField] NetTable netTable;

        ISession session;

        void Start()
        {
            soloButton.onClick.AddListener(PlaySolo);
            hostButton.onClick.AddListener(() => _ = HostAsync());
            joinButton.onClick.AddListener(() => _ = JoinAsync());
            netTable.StatusChanged += s => statusText.text = s;
            netTable.StateChanged += _ => menuPanel.SetActive(false);   // 收到第一個牌桌畫面就關選單
            statusText.text = "選一個模式開始";
        }

        void PlaySolo()
        {
            menuPanel.SetActive(false);
            view.Bind(localTable);
            localTable.StartGame();
        }

        async Task SignInAsync()
        {
            if (UnityServices.State != ServicesInitializationState.Initialized)
            {
                var options = new InitializationOptions();
#if UNITY_EDITOR
                // 同一台電腦開兩個視窗測試時，讓兩邊用不同的匿名帳號
                options.SetProfile("p" + UnityEngine.Random.Range(0, 100000));
#endif
                await UnityServices.InitializeAsync(options);
            }
            if (!AuthenticationService.Instance.IsSignedIn)
                await AuthenticationService.Instance.SignInAnonymouslyAsync();
        }

        async Task HostAsync()
        {
            SetButtons(false);
            statusText.text = "開房間中…";
            try
            {
                await SignInAsync();
                view.Bind(netTable);
                var options = new SessionOptions { MaxPlayers = 2, IsPrivate = true }.WithRelayNetwork();
                session = await MultiplayerService.Instance.CreateSessionAsync(options);
                statusText.text = $"房間代碼：<b>{session.Code}</b>\n傳給朋友，等他加入";
            }
            catch (Exception e)
            {
                statusText.text = "開房失敗：" + e.Message;
                SetButtons(true);
            }
        }

        async Task JoinAsync()
        {
            string code = codeInput.text.Trim().ToUpperInvariant();
            if (string.IsNullOrEmpty(code)) { statusText.text = "先輸入朋友給你的代碼"; return; }

            SetButtons(false);
            statusText.text = "加入中…";
            try
            {
                await SignInAsync();
                view.Bind(netTable);
                session = await MultiplayerService.Instance.JoinSessionByCodeAsync(code);
                statusText.text = "連上了，等房主發牌…";
            }
            catch (Exception e)
            {
                statusText.text = "加入失敗：" + e.Message;
                SetButtons(true);
            }
        }

        void SetButtons(bool on)
        {
            soloButton.interactable = hostButton.interactable = joinButton.interactable = on;
        }

        async void OnDestroy()
        {
            if (session != null)
            {
                try { await session.LeaveAsync(); } catch { /* 關遊戲時離房失敗就算了 */ }
            }
        }
    }
}
