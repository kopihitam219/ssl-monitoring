'use client';
import { createContext, useContext } from 'react';

/** Info user yang sedang login + helper izin, bisa dipakai di komponen mana pun. */
export const SessionContext = createContext({ user: null, can: () => false, isAdmin: false });
export const useSession = () => useContext(SessionContext);

export function makeSession(user) {
  const isAdmin = user?.role === 'admin';
  return { user, isAdmin, can: (perm) => !!user && (isAdmin || (user.permissions || []).includes(perm)) };
}

export const ROLE_LABEL = { admin: 'Admin', monitoring: 'Monitoring' };
