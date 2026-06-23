import { db } from "@workspace/db";
import {
  booksTable,
  quotesTable,
  usersTable,
  commentsTable,
  commentLikesTable,
  userHighlightsTable,
  friendshipsTable,
} from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { logger } from "./logger";
import {
  normalizeText,
  hashText,
  normalizeTitle,
  normalizeAuthor,
} from "./text";

const BOOKS = [
  {
    title: "Pride and Prejudice",
    author: "Jane Austen",
    description:
      "A witty and romantic novel following Elizabeth Bennet as she navigates issues of manners, upbringing, morality, and marriage in 19th-century England.",
    coverColor: "#8B5E3C",
    quotes: [
      "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife. However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered as the rightful property of some one or other of their daughters.",
      "My dear Mr. Bennet, said his lady to him one day, have you heard that Netherfield Park is let at last? Mr. Bennet replied that he had not. But it is, returned she; for Mrs. Long has just been here, and she told me all about it.",
      "Mr. Bennet was so odd a mixture of quick parts, sarcastic humour, reserve, and caprice, that the experience of three-and-twenty years had been insufficient to make his wife understand his character. Her mind was less difficult to develop. She was a woman of mean understanding, little information, and uncertain temper.",
      "In vain I have struggled. It will not do. My feelings will not be repressed. You must allow me to tell you how ardently I admire and love you. Elizabeth's astonishment was beyond expression. She stared, coloured, doubted, and was silent.",
      "I could easily forgive his pride, if he had not mortified mine. Elizabeth Bennet to Jane, speaking of Mr. Darcy at Netherfield, where his manner had been particularly proud and contemptuous.",
      "You are too generous to trifle with me. If your feelings are still what they were last April, tell me so at once. My affections and wishes are unchanged, but one word from you will silence me on this subject for ever.",
      "She began to comprehend that he was exactly the man who, in disposition and talents, would most suit her. His understanding and temper, though unlike her own, would have answered all her wishes. It was an union that must have been to the advantage of both.",
      "I am the happiest creature in the world. Perhaps other people have said so before, but not one with such justice. I am happier even than Jane; she only smiles, I laugh.",
      "There is, I believe, in every disposition a tendency to some particular evil, a natural defect, which not even the best education can overcome. And your defect is a propensity to hate every body. And yours, he replied with a smile, is wilfully to misunderstand them.",
      "What are men to rocks and mountains? Oh! what hours of transport we shall spend! And when we do return, it shall not be like other travellers, without being able to give one accurate idea of any thing.",
      "Think only of the past as its remembrance gives you pleasure. Elizabeth's lesson to herself after her mistakes in judging Darcy and Wickham.",
      "My good opinion once lost is lost for ever. I have faults enough, but they are not, I hope, of understanding.",
    ],
  },
  {
    title: "Moby-Dick",
    author: "Herman Melville",
    description:
      "The epic tale of Captain Ahab's obsessive quest to hunt the white sperm whale, Moby Dick, exploring themes of fate, free will, and obsession.",
    coverColor: "#1E3A5F",
    quotes: [
      "Call me Ishmael. Some years ago—never mind how long precisely—having little money in my pocket and nothing particular to interest me on shore, I thought I would sail about a little and see the watery part of the world.",
      "Whenever I find myself growing grim about the mouth; whenever it is a damp, drizzly November in my soul; whenever I find myself involuntarily pausing before coffin warehouses, and bringing up the rear of every funeral I meet; I account it high time to get to sea as soon as I can.",
      "There is a wisdom that is woe; but there is a woe that is madness. And there is a Catskill eagle in some souls that can alike dive down into the blackest gorges, and soar out of them again and become invisible in the sunny spaces.",
      "I know not all that may be coming, but be it what it will, I'll go to it laughing. Stubb, the second mate, showing his carefree attitude in the face of danger.",
      "It is not down on any map; true places never are. Queequeg's island home, and by extension the truth of experience itself, cannot be captured on any chart.",
      "To produce a mighty book, you must choose a mighty theme. No great and enduring volume can ever be written on the flea, though many there be who have tried it.",
      "He piled upon the whale's white hump the sum of all the general rage and hate felt by his whole race from Adam down; and then, as if his chest had been a mortar, he burst his hot heart's shell upon it.",
      "I am not a brave man; never said I was a brave man; I am a coward; and I sing to keep myself from being afraid. Stubb's confession, revealing the humanity beneath his cheerful exterior.",
      "All men live enveloped in whale-lines. All are born with halters round their necks; but it is only when caught in the swift, sudden turn of death, that mortals realize the silent, subtle, ever-present perils of life.",
      "There is one knows not what sweet mystery about this sea, whose gently awful stirrings seem to speak of some hidden soul beneath; like those fabled undulations of the Ephesian sod over the buried Evangelist St. John.",
      "It is not seldom the case that when a man is at sea, he sees more of the ocean's floor than of its surface, though this too is ocean's surface.",
      "Toward thee I roll, thou all-destroying but unconquering whale; to the last I grapple with thee; from hell's heart I stab at thee; for hate's sake I spit my last breath at thee.",
    ],
  },
  {
    title: "The Picture of Dorian Gray",
    author: "Oscar Wilde",
    description:
      "A gothic novel in which the beautiful Dorian Gray sells his soul for eternal youth and beauty, while his portrait ages and grows hideous with each sin he commits.",
    coverColor: "#4A1942",
    quotes: [
      "The books that the world calls immoral are books that show the world its own shame. Oscar Wilde's provocative statement on art and morality through Lord Henry.",
      "To define is to limit. The moment you put a definition on something, you make it smaller than it is. Lord Henry's philosophy on the nature of identity and experience.",
      "I don't want to be at the mercy of my emotions. I want to use them, to enjoy them, and to dominate them. Dorian Gray on his desired relationship with his own feelings.",
      "The only way to get rid of a temptation is to yield to it. Resist it, and your soul grows sick with longing for the things it has forbidden to itself, with desire for what its monstrous laws have made monstrous and unlawful.",
      "Nowadays people know the price of everything and the value of nothing. Lord Henry's famous aphorism, a cutting critique of Victorian materialism and moral bankruptcy.",
      "Behind every exquisite thing that existed, there was something tragic. The world had always been like that. Dorian's growing awareness of the dark undercurrent beneath beauty.",
      "You will always be fond of me. I represent to you all the sins you never had the courage to commit. Lord Henry to Dorian, articulating the seductive danger of their friendship.",
      "There is only one thing in life worse than being talked about, and that is not being talked about. Lord Henry on the social currency of reputation and scandal.",
      "Experience is merely the name men gave to their mistakes. Lord Henry reframing regret as nothing more than a vocabulary problem.",
      "One can always be kind to people about whom one cares nothing. That is why English society is so unpleasant. It consists of perfectly charming people who are perfectly heartless.",
      "To regret one's own experiences is to arrest one's own development. To deny one's own experiences is to put a lie into the lips of one's own life. It is no less than a denial of the soul.",
      "I am too fond of reading books to care to write them. Lord Henry, the eternal observer, preferring to experience life through others rather than create his own story.",
    ],
  },
];

const DEMO_USERS = [
  { username: "readingwitch", color: "#C084FC" },
  { username: "bookworm42", color: "#4A9EFF" },
  { username: "philosophybird", color: "#34D399" },
  { username: "nightowlreader", color: "#FB923C" },
  { username: "literaturelover", color: "#F472B6" },
  { username: "marginnotes", color: "#E8A020" },
  { username: "dogeared", color: "#60A5FA" },
  { username: "quietpages", color: "#A78BFA" },
  { username: "inkandpaper", color: "#FF6B6B" },
  { username: "chapterzero", color: "#7CB9A8" },
  { username: "footnotefan", color: "#34D399" },
  { username: "spinecracker", color: "#FB923C" },
  { username: "prosepoet", color: "#F472B6" },
  { username: "verseandvale", color: "#4A9EFF" },
  { username: "latenightlit", color: "#C084FC" },
];

// bookIdx -> quoteIdx -> comments
const SEED_COMMENTS: Record<
  number,
  Record<number, Array<{ userIdx: number; text: string; likes: number }>>
> = {
  0: {
    0: [
      { userIdx: 0, text: "The irony in this opening line is so thick you could cut it with a knife. Austen is mocking the very society she's describing.", likes: 47 },
      { userIdx: 1, text: "This single sentence contains so much social commentary. The idea that a man's fortune determines his 'need' for a wife is absurd on its face.", likes: 31 },
      { userIdx: 2, text: "The passive voice here is genius — 'must be in want of a wife' puts the desire on the man but the entire sentence reveals it's actually the women's families who want it.", likes: 89 },
    ],
    3: [
      { userIdx: 1, text: "Darcy's confession is one of the most improbably romantic things in fiction — he starts by insulting her and somehow still means it as a declaration of love.", likes: 62 },
      { userIdx: 3, text: "Elizabeth's silence says everything here. Austen understood that the most powerful response is sometimes no response at all.", likes: 28 },
    ],
    5: [
      { userIdx: 2, text: "The second proposal is so different from the first — humble, honest, vulnerable. Character growth made literal in dialogue.", likes: 54 },
      { userIdx: 4, text: "The phrase 'one word from you will silence me' is heartbreaking. He's completely given up control over the situation.", likes: 41 },
      { userIdx: 0, text: "Austen uses such restrained language here but the emotion underneath is overwhelming. She trusts the reader to feel it.", likes: 73 },
    ],
    8: [
      { userIdx: 3, text: "This is the core of the whole book. Darcy's 'propensity to hate everybody' vs Elizabeth's 'wilful misunderstanding' — two people perfectly matched in their flaws.", likes: 95 },
    ],
    10: [
      { userIdx: 4, text: "Think only of the past as its remembrance gives you pleasure. I wish I could actually live by this. Easier said than done, Jane.", likes: 38 },
      { userIdx: 1, text: "This is Elizabeth at her most mature. She's learned to let go of regret — a complete character arc compressed into one sentence.", likes: 44 },
    ],
  },
  1: {
    0: [
      { userIdx: 0, text: "Three words to open one of the greatest novels ever written. 'Call me Ishmael.' The informality of it is startling — like he's introducing himself at a bar.", likes: 83 },
      { userIdx: 2, text: "The ambiguity of 'Call me Ishmael' — is that his real name? — sets up a whole novel about identity, perspective, and unreliable narration.", likes: 67 },
    ],
    1: [
      { userIdx: 3, text: "This is literally me on a Sunday when I need to book a trip. 'A damp drizzly November in my soul' is the most accurate description of depression I've ever read.", likes: 112 },
      { userIdx: 1, text: "Melville understood restlessness so deeply. The sea as an antidepressant — escape as therapy. Very 19th century but still relatable.", likes: 58 },
      { userIdx: 4, text: "The line about 'coffin warehouses' is so darkly funny. He's describing suicidal ideation and then immediately frames sailing as the cure.", likes: 77 },
    ],
    6: [
      { userIdx: 0, text: "Ahab transferring ALL human rage onto a single whale is the most perfect metaphor for obsession. He didn't just want revenge — he needed the universe to have a face to hate.", likes: 91 },
      { userIdx: 2, text: "The word 'burst' here is incredible. His grief and hatred are contained like pressure, and the whale becomes the release valve.", likes: 34 },
    ],
    11: [
      { userIdx: 4, text: "Ahab's final words and Melville's final structure here mirror each other. The novel itself is Ahab — obsessive, spiraling, magnificent, doomed.", likes: 55 },
      { userIdx: 3, text: "From hell's heart I stab at thee. Three words borrowed by Khan in Star Trek II. This passage launched a thousand cultural references.", likes: 69 },
    ],
  },
  2: {
    3: [
      { userIdx: 1, text: "Lord Henry is basically the devil whispering in Dorian's ear this entire novel. And Wilde lets him sound completely reasonable.", likes: 88 },
      { userIdx: 4, text: "The philosophy of yielding to temptation as spiritual health vs. the Victorian gospel of restraint — Wilde knew exactly how scandalous this was.", likes: 44 },
      { userIdx: 0, text: "This is genuinely dangerous advice. But Wilde frames it so persuasively that you have to stop and think about why it's wrong.", likes: 61 },
    ],
    4: [
      { userIdx: 2, text: "Possibly the most quoted line in the novel. Wilde weaponized wit against his entire era's value system and wrapped it in a single sentence.", likes: 134 },
      { userIdx: 3, text: "The 'price of everything, value of nothing' line predates modern consumer culture by 100 years. Wilde was writing about us.", likes: 97 },
    ],
    6: [
      { userIdx: 0, text: "Lord Henry sees himself as Dorian's mirror. He projects onto Dorian all his own cowardice and unfulfilled desire. The friendship is fundamentally exploitative.", likes: 72 },
      { userIdx: 1, text: "The word 'courage' is devastating. Henry is essentially admitting that Dorian's corruption is also his own fantasy.", likes: 48 },
    ],
    9: [
      { userIdx: 4, text: "'Kind to people about whom one cares nothing' — Wilde understood that social grace and genuine warmth are entirely different things. The English aristocracy proved it.", likes: 59 },
    ],
  },
};

// bookIdx -> quoteIdx -> number of distinct users who highlighted it (drives the
// "most highlighted" feature + reader highlight intensity tiers).
const SEED_HIGHLIGHTS: Record<number, Record<number, number>> = {
  0: { 0: 14, 2: 2, 3: 9, 5: 12, 6: 5, 8: 6, 10: 4 },
  1: { 0: 13, 1: 15, 4: 3, 6: 8, 9: 5, 11: 11 },
  2: { 0: 2, 3: 10, 4: 15, 5: 6, 6: 7, 9: 4 },
};

export async function seedDatabase(): Promise<void> {
  try {
    const existingBooks = await db.select().from(booksTable).limit(1);
    if (existingBooks.length > 0) {
      logger.info("Database already seeded, skipping.");
      return;
    }

    logger.info("Seeding database...");

    const insertedUsers = await db
      .insert(usersTable)
      .values(DEMO_USERS.map((u) => ({ username: u.username, avatarColor: u.color })))
      .returning();

    // Seed a directional follow web so demo profiles show realistic
    // follower/following counts (and some mutual "friends"). Each user follows
    // the next 3 users (wrapping). Symmetric wrap creates mutual pairs.
    const followRows: { userId: number; friendId: number }[] = [];
    for (let i = 0; i < insertedUsers.length; i++) {
      for (let offset = 1; offset <= 3; offset++) {
        const target = insertedUsers[(i + offset) % insertedUsers.length]!;
        const me = insertedUsers[i]!;
        if (me.id !== target.id) {
          followRows.push({ userId: me.id, friendId: target.id });
        }
      }
    }
    if (followRows.length > 0) {
      await db.insert(friendshipsTable).values(followRows).onConflictDoNothing();
    }

    for (let bookIdx = 0; bookIdx < BOOKS.length; bookIdx++) {
      const book = BOOKS[bookIdx]!;
      const [insertedBook] = await db
        .insert(booksTable)
        .values({
          title: book.title,
          author: book.author,
          normTitle: normalizeTitle(book.title),
          normAuthor: normalizeAuthor(book.author),
          description: book.description,
          coverColor: book.coverColor,
        })
        .returning();
      if (!insertedBook) continue;

      // Insert quotes for this canonical book.
      await db.insert(quotesTable).values(
        book.quotes.map((text) => {
          const normText = normalizeText(text);
          return {
            canonicalBookId: insertedBook.id,
            text,
            normText,
            normTextHash: hashText(normText),
          };
        }),
      );

      // Re-read in stable (insertion) order so quote index matches the seed arrays.
      const bookQuotes = await db
        .select()
        .from(quotesTable)
        .where(eq(quotesTable.canonicalBookId, insertedBook.id))
        .orderBy(asc(quotesTable.id));

      // Comments anchored to quotes.
      const bookComments = SEED_COMMENTS[bookIdx];
      if (bookComments) {
        for (const [quoteIdxStr, commentList] of Object.entries(bookComments)) {
          const quote = bookQuotes[parseInt(quoteIdxStr, 10)];
          if (!quote) continue;

          for (const commentData of commentList) {
            const user = insertedUsers[commentData.userIdx];
            if (!user) continue;

            const [comment] = await db
              .insert(commentsTable)
              .values({
                quoteId: quote.id,
                userId: user.id,
                text: commentData.text,
                likeCount: commentData.likes,
              })
              .returning();
            if (!comment) continue;

            const likerIndices = Array.from(
              { length: Math.min(commentData.likes, insertedUsers.length) },
              (_, i) => i,
            ).filter((i) => i !== commentData.userIdx);

            if (likerIndices.length > 0) {
              await db.insert(commentLikesTable).values(
                likerIndices.map((i) => ({
                  commentId: comment.id,
                  userId: insertedUsers[i]!.id,
                })),
              );
            }
          }
        }
      }

      // Community highlights anchored to quotes.
      const bookHighlights = SEED_HIGHLIGHTS[bookIdx];
      if (bookHighlights) {
        for (const [quoteIdxStr, count] of Object.entries(bookHighlights)) {
          const quote = bookQuotes[parseInt(quoteIdxStr, 10)];
          if (!quote) continue;
          const n = Math.min(count, insertedUsers.length);
          if (n <= 0) continue;
          await db.insert(userHighlightsTable).values(
            Array.from({ length: n }, (_, i) => ({
              userId: insertedUsers[i]!.id,
              quoteId: quote.id,
            })),
          );
        }
      }
    }

    logger.info("Database seeded successfully.");
  } catch (err) {
    logger.error({ err }, "Failed to seed database");
  }
}
