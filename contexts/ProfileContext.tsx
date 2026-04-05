import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { auth, db } from '../firebaseConfig';

interface ProfileData {
  nickname: string;
  profileImage: string;
  partnerId: string;
  isReady: boolean;
}

const ProfileContext = createContext<ProfileData>({ nickname: '', profileImage: '', partnerId: '', isReady: false });

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<ProfileData>({ nickname: '', profileImage: '', partnerId: '', isReady: false });
  const unsubFirestoreRef = useRef<(() => void) | null>(null);

  function setupListener(uid: string) {
    unsubFirestoreRef.current?.();
    unsubFirestoreRef.current = onSnapshot(doc(db, 'users', uid), snap => {
      if (snap.exists()) {
        const data = snap.data();
        setProfile({
          nickname: data.nickname ?? '',
          profileImage: data.profileImage ?? '',
          partnerId: data.partnerId ?? '',
          isReady: true,
        });
      }
    });
  }

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, user => {
      if (user) {
        setupListener(user.uid);
      } else {
        unsubFirestoreRef.current?.();
        unsubFirestoreRef.current = null;
        setProfile({ nickname: '', profileImage: '', partnerId: '', isReady: false });
      }
    });

    return () => {
      unsubFirestoreRef.current?.();
      unsubAuth();
    };
  }, []);

  return (
    <ProfileContext.Provider value={profile}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  return useContext(ProfileContext);
}
