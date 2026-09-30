import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface RecoveryStatusBadgeProps {
  status: string;
}

export function RecoveryStatusBadge({ status }: RecoveryStatusBadgeProps) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    DETECTED: "secondary",
    ANALYSING: "secondary",
    AWAITING_APPROVAL: "default",
    APPROVED: "default",
    SENT: "default",
    MONITORING: "default",
    RECOVERED: "default",
    STOPPED: "secondary",
    UNRECOVERED: "destructive",
    EXPIRED: "destructive",
    ESCALATED: "destructive",
    REJECTED: "destructive",
  };

  const customClasses: Record<string, string> = {
    RECOVERED: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    SENT: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    DETECTED: "bg-red-500/15 text-red-300 border-red-500/30",
  };

  return (
    <Badge
      variant={variants[status] || "outline"}
      className={cn("uppercase text-xs font-semibold", customClasses[status])}
    >
      {status}
    </Badge>
  );
}
