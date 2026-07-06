"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function V3Page() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/v3/tickets");
  }, [router]);
  return (
    <div className="flex items-center justify-center h-64">
      <p className="text-[#86909c]">正在跳转...</p>
    </div>
  );
}
