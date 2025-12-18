
import type { SVGProps } from 'react';

export function LlineStreamLogo({ appName = "LlineStream", ...props }: SVGProps<SVGSVGElement> & { appName?: string }) {
  // A rough approximation to adjust viewBox based on text length. Increased multiplier for wider characters.
  const estimatedWidth = (appName.length * 35) + 20; 
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${estimatedWidth} 50`}
      width={estimatedWidth / 2.5} // Adjusted divisor for better scaling
      height="30"
      data-version="1.1" 
      {...props}
    >
      <text
        x="10"
        y="35"
        fontFamily="Poppins, sans-serif"
        fontSize="32"
        fontWeight="bold"
        fill="hsl(var(--primary))"
        className="dark:fill-primary"
      >
        {appName}
      </text>
    </svg>
  );
}

export function KakaoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      {...props}
    >
      <path
        fill="#3A1D1D"
        d="M12 2c-5.523 0-10 3.582-10 8s4.477 8 10 8c1.62 0 3.129-.323 4.485-.895l2.515 1.895-1.02-2.859c1.65-1.332 2.62-3.23 2.62-5.141 0-4.418-4.477-8-10-8z"
      ></path>
    </svg>
  );
}
