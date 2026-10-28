// 구글 로그인 + Firestore로 휴대폰·PC 단어장 공유
// - 로그인하면 단어장이 users/{내 uid}/words/{단어} 에 저장된다.
// - 이 기기의 localStorage는 화면을 빨리 그리기 위한 사본으로 계속 쓴다.
// - 처음 로그인할 때 이 기기에만 있던 단어는 계정 단어장으로 올린다.

import { firebaseConfig } from "./firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/13.0.0/";

const accountEl = document.getElementById("account");

async function start() {
  if (!firebaseConfig) return; // 설정 전이면 기기별 저장만

  const { initializeApp } = await import(SDK + "firebase-app.js");
  const { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut } =
    await import(SDK + "firebase-auth.js");
  const { getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot, writeBatch } = await import(
    SDK + "firebase-firestore.js"
  );

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  let stopListening = null;

  const wordsRef = (uid) => collection(db, "users", uid, "words");
  const wordDoc = (uid, word) => doc(db, "users", uid, "words", encodeURIComponent(word));
  // Firestore는 undefined 값을 받지 않아서 JSON으로 한 번 걸러 낸다.
  const plain = (w) => JSON.parse(JSON.stringify(w));

  async function login() {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      // 팝업이 막히는 브라우저(일부 앱 내부 브라우저 등)는 페이지 이동 방식으로 다시 시도
      if (err.code === "auth/popup-blocked" || err.code === "auth/operation-not-supported-in-this-environment") {
        await signInWithRedirect(auth, provider);
      } else if (err.code !== "auth/popup-closed-by-user" && err.code !== "auth/cancelled-popup-request") {
        alert("로그인하지 못했어요: " + err.code);
      }
    }
  }

  // 로그아웃하면 이 기기의 사본도 지운다 (다른 사람이 같은 기기로 로그인해도 섞이지 않게).
  // 단어장은 계정에 남아 있어서 다시 로그인하면 돌아온다.
  async function logout() {
    await signOut(auth);
    replaceLocalWords([]);
  }

  function renderAccount(user) {
    if (user) {
      accountEl.replaceChildren(
        el("span", { class: "muted small" }, "☁ " + (user.email || "로그인됨") + " · 기기 간 공유 중"),
        el("button", { class: "ghost", type: "button", onclick: logout }, "로그아웃")
      );
    } else {
      accountEl.replaceChildren(
        el("span", { class: "muted small" }, "로그인하면 휴대폰·PC 단어장이 공유돼요."),
        el("button", { type: "button", onclick: login }, "구글로 로그인")
      );
    }
    accountEl.hidden = false;
  }

  // 처음 로그인: 이 기기에만 있던 단어를 계정으로 올린다. 같은 단어가 있으면 외운 횟수가 많은 쪽을 남긴다.
  async function uploadLocalWords(uid, cloudWords) {
    const cloud = new Map(cloudWords.map((w) => [w.word, w]));
    const batch = writeBatch(db);
    let count = 0;
    for (const w of loadWords()) {
      const c = cloud.get(w.word);
      if (!c || w.checks > c.checks) {
        batch.set(wordDoc(uid, w.word), plain(w));
        count++;
      }
    }
    if (count) await batch.commit();
  }

  onAuthStateChanged(auth, (user) => {
    renderAccount(user);
    if (stopListening) stopListening();
    stopListening = null;
    window.wordSync = null;

    if (!user) return;

    let first = true;
    stopListening = onSnapshot(
      wordsRef(user.uid),
      async (snap) => {
        const words = snap.docs.map((d) => d.data());
        if (first) {
          first = false;
          await uploadLocalWords(user.uid, words); // 올리면 onSnapshot이 다시 불려 화면이 갱신된다
        }
        replaceLocalWords(words);
      },
      (err) => {
        statusEl.textContent = "단어장을 불러오지 못했어요 (" + err.code + ")";
      }
    );

    // app.js가 단어를 저장·체크·삭제할 때 부르는 함수
    window.wordSync = {
      save: (w) => setDoc(wordDoc(user.uid, w.word), plain(w)),
      remove: (word) => deleteDoc(wordDoc(user.uid, word)),
    };
  });
}

start().catch((err) => {
  console.error(err);
  accountEl.hidden = false;
  accountEl.textContent = "공유 기능을 불러오지 못했어요. 이 기기에만 저장돼요.";
});
