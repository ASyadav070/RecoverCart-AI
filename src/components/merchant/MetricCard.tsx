import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  title: string;
  value: string | number;
  description?: string;
  variant?: "default" | "success" | "warning" | "brand";
  className?: string;
}

export function MetricCard({ title, value, description, variant = "default", className }: MetricCardProps) {
  const valueStyles = {
    default: "text-zinc-100",
    success: "text-emerald-400",
    warning: "text-amber-400",
    brand: "text-indigo-400",
  };

  return (
    <Card className={cn("bg-zinc-900 border-zinc-800", className)}>
      <CardContent className="p-6">
        <p className="text-zinc-400 text-sm mb-1 font-medium">{title}</p>
        <p className={cn("text-2xl font-bold tracking-tight", valueStyles[variant])}>
          {value}
        </p>
        {description && <p className="text-zinc-500 text-xs mt-1">{description}</p>}
      </CardContent>
    </Card>
  );
}
