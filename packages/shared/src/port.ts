/** 端口类型：决定节点之间能否连线。 */
export const PORT_TYPES = ["audio", "transcript", "noteBlock", "noteDoc"] as const;

export type PortType = (typeof PORT_TYPES)[number];

export interface PortSpec {
  /** 端口 id，同时用作 Handle id。 */
  id: string;
  type: PortType;
  /** 检查器/悬停提示里的中文名。 */
  label?: string;
}

/** 判断 from → to 是否可连接。 */
export function canConnect(from: PortType, to: PortType): boolean {
  switch (to) {
    case "audio":
      return from === "audio";
    case "transcript":
      return from === "transcript";
    case "noteBlock":
      return from === "noteBlock";
    case "noteDoc":
      return from === "noteBlock" || from === "noteDoc";
  }
}
