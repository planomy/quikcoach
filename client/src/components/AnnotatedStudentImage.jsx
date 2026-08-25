export default function AnnotatedStudentImage({
  imageUrl,
  markupUrl = '',
  alt = '',
  className = '',
  imageClassName = 'max-h-56 w-full object-contain',
}) {
  if (!imageUrl) return null;
  return (
    <div className={`relative grid place-items-center ${className}`}>
      <img
        src={imageUrl}
        alt={alt}
        className={`col-start-1 row-start-1 ${imageClassName}`}
      />
      {markupUrl && (
        <img
          src={markupUrl}
          alt="Teacher drawing correction"
          className={`pointer-events-none col-start-1 row-start-1 ${imageClassName}`}
        />
      )}
    </div>
  );
}
