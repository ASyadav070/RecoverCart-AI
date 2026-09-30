import { ReactNode } from "react";
import { PageContainer } from "@/components/layout/PageContainer";

export default function MerchantLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <PageContainer>
        {children}
      </PageContainer>
    </div>
  );
}
