import { Button } from "@/components/ui/button";

interface ActionPanelProps {
  status: string;
  actionState: "idle" | "approving" | "rejecting" | "regenerating";
  generationType: "initial" | "rejection" | null;
  loading: boolean;
  onGenerate?: () => void;
  onApprove?: () => void;
  onReject?: () => void;
  onSendOutreach?: () => void;
}

export function ActionPanel({
  status,
  actionState,
  generationType,
  loading,
  onGenerate,
  onApprove,
  onReject,
  onSendOutreach,
}: ActionPanelProps) {
  return (
    <div className="space-y-4">
      {/* Feedback Area */}
      {actionState === "regenerating" && generationType === "rejection" && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-900 bg-amber-950/30 px-4 py-3 text-sm text-amber-400">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
          Proposal rejected. Generating a revised proposal...
        </div>
      )}

      {actionState === "regenerating" && generationType === "initial" && (
        <div className="flex items-center gap-3 py-2 text-sm text-indigo-400">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
          Generating recovery strategy...
        </div>
      )}

      {status === "ANALYSING" && actionState === "idle" && (
        <div className="flex items-center gap-3 py-2 text-sm text-indigo-400">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
          Generating recovery strategy...
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {status === "DETECTED" && onGenerate && (
          <Button onClick={onGenerate} disabled={loading}>
            {loading ? "Generating..." : "Generate Strategy"}
          </Button>
        )}

        {status === "AWAITING_APPROVAL" && (
          <>
            {onApprove && (
              <Button onClick={onApprove} disabled={loading}>
                Approve
              </Button>
            )}

            {onReject && (
              <Button
                onClick={onReject}
                variant="destructive"
                disabled={loading}
              >
                Reject
              </Button>
            )}
          </>
        )}

        {status === "APPROVED" && onSendOutreach && (
          <Button onClick={onSendOutreach} disabled={loading}>
            Send Simulated Outreach
          </Button>
        )}
      </div>
    </div>
  );
}