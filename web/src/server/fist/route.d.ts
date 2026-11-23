// 型別宣告：讓 worker.ts（TypeScript）能匯入 JS 寫的拳刃交鋒伺服器
export declare function handleFist(req: Request, ns: DurableObjectNamespace, opts?: { allowCreate?: () => Promise<boolean> }): Promise<Response | null>;
