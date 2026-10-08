import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import API_URL from "../config/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [profile, setProfile] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
    const response = await fetch(`${API_URL}/auth/profile`, {
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error("Unable to refresh account approval status.");
    }

    const nextProfile = await response.json();
    setProfile(nextProfile);
    return nextProfile;
  }, []);

  useEffect(() => {
    localStorage.removeItem("accessToken");

    let mounted = true;
    fetch(`${API_URL}/auth/profile`, {
      credentials: "include",
    })
      .then(async (response) => {
        if (!response.ok) return;
        if (mounted) setProfile(await response.json());
      })
      .catch((error) => console.error("Unable to restore the signed-in session.", error))
      .finally(() => mounted && setIsLoading(false));

    return () => {
      mounted = false;
    };
  }, []);

  const completeLogin = useCallback(async (response) => {
    let signedInProfile;
    try {
      const profileResponse = await fetch(`${API_URL}/auth/profile`, {
        credentials: "include",
      });
      if (!profileResponse.ok) {
        throw new Error("Unable to load the signed-in user.");
      }
      signedInProfile = await profileResponse.json();
    } catch (error) {
      await fetch(`${API_URL}/auth/logout`, {
        method: "POST",
        credentials: "include",
      }).catch((logoutError) =>
        console.error("Unable to clear a session after profile loading failed.", logoutError),
      );
      throw error;
    }
    setProfile(signedInProfile);
    return { response, profile: signedInProfile };
  }, []);

  const login = useCallback(async (username, password) => {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!response.ok) return { response, profile: null };

    const result = await response.json();
    if (result.requiresOtp) {
      return { response, profile: null, requiresOtp: true, maskedEmail: result.maskedEmail };
    }

    return completeLogin(response);
  }, [completeLogin]);

  const verifyLoginOtp = useCallback(async (username, code) => {
    const response = await fetch(`${API_URL}/auth/login/verify-otp`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, code }),
    });
    if (!response.ok) return { response, profile: null };
    return completeLogin(response);
  }, [completeLogin]);

  const logout = useCallback(() => {
    setProfile(null);
    void fetch(`${API_URL}/auth/logout`, {
      method: "POST",
      credentials: "include",
    }).then((response) => {
      if (!response.ok) throw new Error(`Logout request failed (${response.status}).`);
    }).catch((error) => console.error("Unable to clear the server session.", error));
  }, []);

  const value = useMemo(
    () => ({
      profile,
      isAuthenticated: Boolean(profile),
      isLoading,
      login,
      verifyLoginOtp,
      logout,
      refreshProfile,
    }),
    [isLoading, profile, login, verifyLoginOtp, logout, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
