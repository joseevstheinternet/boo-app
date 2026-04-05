import { doc, onSnapshot } from 'firebase/firestore';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { db } from '../firebaseConfig';
import { useProfile } from './ProfileContext';

interface PartnerProfile {
  nickname: string;
  profileImage: string;
  isReady: boolean;
}

const PartnerProfileContext = createContext<PartnerProfile>({ nickname: '', profileImage: '', isReady: false });

export function PartnerProfileProvider({ children }: { children: React.ReactNode }) {
  const { partnerId } = useProfile();
  const [partner, setPartner] = useState<PartnerProfile>({ nickname: '', profileImage: '', isReady: false });
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    unsubRef.current?.();
    unsubRef.current = null;

    if (!partnerId) {
      setPartner({ nickname: '', profileImage: '', isReady: false });
      return;
    }

    unsubRef.current = onSnapshot(doc(db, 'users', partnerId), snap => {
      if (snap.exists()) {
        setPartner({
          nickname: snap.data().nickname ?? '',
          profileImage: snap.data().profileImage ?? '',
          isReady: true,
        });
      }
    });

    return () => {
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, [partnerId]);

  return (
    <PartnerProfileContext.Provider value={partner}>
      {children}
    </PartnerProfileContext.Provider>
  );
}

export function usePartnerProfile() {
  return useContext(PartnerProfileContext);
}
