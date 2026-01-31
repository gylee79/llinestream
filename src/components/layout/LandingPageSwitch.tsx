'use client';

import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useLandingPage } from "@/context/landing-page-context";
import { useIsMobile } from "@/hooks/use-mobile";

export default function LandingPageSwitch() {
    const { preference, togglePreference, isLandingPageLoading } = useLandingPage();
    const isMobile = useIsMobile();

    if (isLandingPageLoading) {
        return null; // Or a skeleton
    }
    
    const isAppVersion = preference === 'original';
    const labelText = isAppVersion ? '홈페이지로 전환' : '강의앱으로 전환';

    return (
        <div className="flex items-center space-x-2">
            <Switch
                id="landing-page-switch"
                checked={isAppVersion}
                onCheckedChange={togglePreference}
            />
            {!isMobile && 
                <Label htmlFor="landing-page-switch" className="text-xs text-muted-foreground whitespace-nowrap">
                    {labelText}
                </Label>
            }
        </div>
    );
}
