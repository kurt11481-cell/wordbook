// Firebase 웹 앱 설정 (Firebase 콘솔 → 프로젝트 설정 → 내 앱에서 복사)
// 비밀값이 아니라 "어느 Firebase 프로젝트를 쓰는지" 알려 주는 공개 정보다.
// 실제 데이터 보호는 Firestore 보안 규칙(firestore.rules)이 맡는다.
// 값이 null이면 로그인·동기화 없이 기기별 저장으로만 동작한다.
export const firebaseConfig = {
  apiKey: "AIzaSyD2QsCE5qG4D8qjE4iwLKDh6bvleUXxT-4",
  authDomain: "english-wordbook-e1f1f.firebaseapp.com",
  projectId: "english-wordbook-e1f1f",
  storageBucket: "english-wordbook-e1f1f.firebasestorage.app",
  messagingSenderId: "272945211892",
  appId: "1:272945211892:web:70c32b43139fcf3c9bb1a1",
};
