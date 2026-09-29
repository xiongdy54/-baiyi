import { createFakeKernel } from "../src/lib/reader/testing/fakeKernel";

type Result = { name: string; pass: boolean; detail?: string };

export async function run(): Promise<Result[]> {
  const results: Result[] = [];
  const check = (name: string, pass: boolean, detail?: unknown) => {
    results.push({ name, pass, detail: detail == null ? "" : String(detail) });
  };
  const kernel = createFakeKernel({ chapters: ["第一章", "第二章", "第三章"] });
  if (typeof kernel.goToMark !== "function" || typeof kernel.setDocumentMarks !== "function") {
    check("精确标记 id 导航到该条 CFI", false, "goToMark 接口缺失");
    check("未知 id 返回 false 且位置不变", false, "goToMark 接口缺失");
    check("没有定位锚的标记返回 false 且位置不变", false, "goToMark 接口缺失");
    check("替换标记列表后旧 id 不再导航", false, "setDocumentMarks/goToMark 接口缺失");
    check("destroy 后重新打开不会恢复旧标记", false, "setDocumentMarks/goToMark 接口缺失");
    return results;
  }

  await kernel.open({ kind: "bytes", bytes: new Uint8Array(0), name: "fake.epub" });
  kernel.setDocumentMarks([
    { id: "mark-one", text: "第一章", cfi: "fake:/6/6", kind: "extract" },
    { id: "mark-two", text: "第二章", cfi: "fake:/6/10", kind: "highlight" }
  ]);
  const didNavigate = await kernel.goToMark("mark-two");
  check("精确标记 id 导航到该条 CFI", didNavigate && kernel.getCurrentLocation()?.cfi === "fake:/6/10", kernel.getCurrentLocation()?.cfi);

  const beforeUnknown = kernel.getCurrentLocation()?.cfi;
  const unknown = await kernel.goToMark("missing");
  check("未知 id 返回 false 且位置不变", unknown === false && kernel.getCurrentLocation()?.cfi === beforeUnknown, kernel.getCurrentLocation()?.cfi);

  kernel.setDocumentMarks([{ id: "unlocated", text: "旧锚无位置", kind: "extract" }]);
  const noCfi = await kernel.goToMark("unlocated");
  check("没有定位锚的标记返回 false 且位置不变", noCfi === false && kernel.getCurrentLocation()?.cfi === beforeUnknown, kernel.getCurrentLocation()?.cfi);

  kernel.setDocumentMarks([{ id: "mark-one", text: "第一章", cfi: "fake:/6/2", kind: "extract" }]);
  const removed = await kernel.goToMark("mark-two");
  check("替换标记列表后旧 id 不再导航", removed === false && kernel.getCurrentLocation()?.cfi === beforeUnknown, kernel.getCurrentLocation()?.cfi);

  kernel.setDocumentMarks([{ id: "destroyed-mark", text: "第三章", cfi: "fake:/6/10", kind: "extract" }]);
  kernel.destroy();
  await kernel.open({ kind: "bytes", bytes: new Uint8Array(0), name: "fake.epub" });
  const beforeDestroyedLookup = kernel.getCurrentLocation()?.cfi;
  const destroyedMark = await kernel.goToMark("destroyed-mark");
  check(
    "destroy 后重新打开不会恢复旧标记",
    destroyedMark === false && kernel.getCurrentLocation()?.cfi === beforeDestroyedLookup,
    kernel.getCurrentLocation()?.cfi
  );
  kernel.destroy();
  return results;
}
