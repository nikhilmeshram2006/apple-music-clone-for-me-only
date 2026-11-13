Apple Music Clone — My Personal Music Player

A personal music player inspired by Apple Music, built around the way I like to listen to music.

I wanted a music app with a clean interface, a good collection of songs, and no ads interrupting my listening. Most platforms either require a subscription or show ads, so I decided to try building my own.

This project is still a work in progress, but it already has a music library, synchronized lyrics, playlists, and a responsive interface.

"Open Live Demo" (https://nikhilmeshram2006.github.io/apple-music-clone-for-me-only/)

---

What can it do?

Here are some of the things I've built so far:

- Music Player — Play full-length tracks with 320 kbps AAC audio streaming, keyboard shortcuts, and Media Session support.
- Synchronized Lyrics — Lyrics follow the song with word-by-word highlighting. You can also click a line to jump to that part of the song.
- Music Library — Browse 218 pre-indexed tracks across different genres, including Pop, J-Pop, K-Pop, Bollywood, Rock, R&B, and more.
- Personal Library — Save favorite songs, create playlists, follow artists, and keep track of listening history.
- Visual Effects — Animated album artwork and backgrounds generated from album covers.
- Search — Find music in the catalog using the search feature.
- Responsive Design — Layouts designed for both desktop and mobile screens.
- PWA Support — Install the web app on supported devices.

---

Why I built this?

I listen to music quite often, but I wasn't happy with how some existing platforms handled the experience. Subscriptions and advertisements can get in the way when all I want to do is listen to my favorite songs.

So I thought: why not try building my own music application?

I wanted something that felt similar to Apple Music in terms of UI and UX, with a clean design, a rich music library, and an uninterrupted listening experience.

I also wanted to keep my favorite songs in one place and be able to listen to them whenever I wanted.

That's how this project started.

---

Some things that were challenging?

Building the interface was only one part of the project. A few other things took considerably more time to figure out.

Working with music APIs,Getting songs from APIs and making them playable without requiring users to download the actual audio files was one of my biggest challenges. I had to work on audio handling and reduce unnecessary waiting during playback.

Building the music catalog Creating and organizing the catalog using Python was another difficult part. I got confused about how to structure and process the data, so I used Claude Opus 5.5 for assistance while working through it.

Desktop and mobile layouts Making the application work well on both desktop and mobile wasn't as simple as making everything smaller. The two layouts needed different proportions and arrangements, so I had to work on them separately.

There are still things I want to improve, especially loading speed and responsiveness.

---

What I learned?

This project helped me understand a few things beyond just building a React interface.

- Working with APIs and handling the data they return.
- Handling audio streams and making playback feel responsive.
- Working with Python to build and organize a music catalog.
- Synchronizing lyrics with audio playback.
- Designing layouts for different screen sizes.
- Improving the overall user experience through testing and debugging.

I learned most of these things while building and fixing problems in the project, rather than just following a tutorial.

---

What I worked on?

I personally handled most of the UI and layout work, along with the Python catalog builder and lyrics synchronization.

I also used AI assistance during development, particularly when I got stuck with the music catalog and API-related implementation.

I see AI as a tool that helped me work through difficult parts, but I still had to understand how the pieces fit together and make the application work as a whole.

---

Tech Stack

Technology| Purpose
React| User interface
JavaScript| Application logic
Vite| Development and build tooling
Python| Music catalog generation
HTML & CSS| Structure and styling
Web APIs| Audio playback and browser integration

---

Running it locally

You'll need Node.js and Python installed.

1. Clone the repository

git clone https://github.com/nikhilmeshram2006/apple-music-clone-for-me-only.git cd apple-music-clone-for-me-only

2. Install dependencies

npm install

3. Start the development server

npm run dev

4. Open the local address

Vite will show you a local URL in the terminal. Open it in your browser.

Building the music catalog

If you want to run the Python catalog builder:

pip install requests pycryptodome rapidfuzz pillow
npm run catalog

Production build

npm run build

The production output is generated in the "docs/" directory for GitHub Pages deployment.

---

What's next?

I don't consider this project finished. There are still quite a few things I'd like to work on.

- Improve loading times and make song playback more responsive.
- Add more high-quality songs to the library.
- Improve animations while keeping the interface minimal.
- Optimize the application further for mobile and desktop.
- Make navigation and everyday interactions easier.
- Continue improving the overall listening experience.

I'll keep working on it and add more features as the project grows.

---

About the Developer

Built by Nikhil, a Computer Science student interested in web development and building things that I actually enjoy using.

This is one of my personal projects, and I'm still learning as I work on it.

GitHub: "@nikhilmeshram2006" (https://github.com/nikhilmeshram2006)

---

Made for my own listening experience. Still a work in progress.
