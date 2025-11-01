"use client";

import { Button } from "@mui/material";
import { getIdpLogoutUrl } from "@/lib/auth/helpers";
import { signOut, useSession } from "next-auth/react";
import { useState } from "react";

interface SignOutButtonProps {
  variant?: "text" | "outlined" | "contained";
  color?: "primary" | "secondary" | "error" | "info" | "success" | "warning";
  fullWidth?: boolean;
}

export default function SignOutButton({
  variant = "contained",
  color = "primary",
  fullWidth = false,
}: SignOutButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const { data: session } = useSession();

  const handleSignOut = async () => {
    try {
      setIsLoading(true);

      // Step 1: Get the IDP logout URL before clearing the session (we need id_token)
      const idpLogoutUrl = getIdpLogoutUrl(session);

      // Step 2: Sign out from NextAuth (clear app session)
      await signOut({ redirect: false });

      // Step 3: Redirect to IDP logout
      if (idpLogoutUrl) {
        window.location.href = idpLogoutUrl;
      } else {
        // Fallback: just redirect to home
        window.location.href = "/";
      }
    } catch (error) {
      console.error("Error signing out:", error);
      setIsLoading(false);
    }
  };

  return (
    <Button
      variant={variant}
      color={color}
      fullWidth={fullWidth}
      onClick={handleSignOut}
      disabled={isLoading}
    >
      {isLoading ? "Signing out..." : "Sign Out"}
    </Button>
  );
}
