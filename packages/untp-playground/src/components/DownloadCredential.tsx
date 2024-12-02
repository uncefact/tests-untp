"use client";

import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

export function DownloadCredential() {
  const handleDownload = async () => {
    try {
      const response = await fetch("/credentials/dpp.json");
      const data = await response.json();

      // Create and download file
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "untp-test-dpp-credential.json";
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.log("Error downloading credential:", error);
    }
  };

  return (
    <Button onClick={handleDownload} variant="outline">
      <Download className="mr-2 h-4 w-4" />
      Download Test Credential
    </Button>
  );
}
