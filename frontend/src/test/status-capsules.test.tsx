import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HealthCapsule, LabCapsule } from "@/noesis/App";

describe("status capsules", () => {
  it("shows a live lab bridge as connected even when the old core API is offline", () => {
    render(<><LabCapsule status="connected" baseUrl="http://127.0.0.1:8765" /><HealthCapsule health={{ loading: false, error: new Error("down"), data: null } as never} /></>);
    expect(screen.getByText("Lab bridge: connected")).toBeInTheDocument();
    const core = screen.getByText("Core API (optional): offline");
    expect(core.className).not.toMatch(/bad/);
    expect(screen.queryByText("Core API offline")).toBeNull();
  });

  it("reports an offline or unconfigured lab bridge separately", () => {
    const { rerender } = render(<LabCapsule status="offline" baseUrl="http://127.0.0.1:8765" />);
    expect(screen.getByText("Lab bridge: offline")).toBeInTheDocument();
    rerender(<LabCapsule status="offline" baseUrl="" />);
    expect(screen.getByText("Lab bridge: not configured")).toBeInTheDocument();
  });
});
