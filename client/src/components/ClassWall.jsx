import RichTextDisplay from './RichTextDisplay.jsx';

function wallName(student, { you, hideNames }) {
  if (you) return 'You';
  if (hideNames) return 'Classmate';
  return String(student?.name || 'Student').trim() || 'Student';
}

export default function ClassWall({
  students = [],
  selfId,
  hideNames = false,
  youCard,
}) {
  const ordered = [...students].sort((left, right) => {
    const leftYou = Number(left.id) === Number(selfId);
    const rightYou = Number(right.id) === Number(selfId);
    if (leftYou !== rightYou) return leftYou ? -1 : 1;
    return String(left.name || '').localeCompare(String(right.name || ''), undefined, { sensitivity: 'base' });
  });

  return (
    <div className="iboard-class-wall" role="list" aria-label="Class writing wall">
      {ordered.map((student) => {
        const you = Number(student.id) === Number(selfId);
        const hasWriting = Boolean(String(student.text || '').trim() || String(student.rich_text_html || '').trim());
        return (
          <article
            key={student.id}
            role="listitem"
            className={`iboard-class-wall__card${you ? ' is-you' : ''}`}
          >
            <header className="iboard-class-wall__head">
              <p className="iboard-class-wall__name">{wallName(student, { you, hideNames })}</p>
            </header>
            <div className="iboard-class-wall__body">
              {you ? youCard : (
                <>
                  {student.image_url ? (
                    <img src={student.image_url} alt="" className="iboard-class-wall__image" />
                  ) : null}
                  {hasWriting ? (
                    <RichTextDisplay html={student.rich_text_html} text={student.text || ''} />
                  ) : (
                    <span className="iboard-class-wall__empty">No writing yet</span>
                  )}
                </>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
