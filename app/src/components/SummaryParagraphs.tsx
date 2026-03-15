export function SummaryParagraphs({ text }: { text: string }) {
  return (
    <>
      {text.split(/\n\n+/).map((para, i) => (
        <p key={i}>{para}</p>
      ))}
    </>
  );
}
