
'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import type { Field, Classification, Course } from '@/lib/types';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase';
import { collection, query, where, doc, addDoc, updateDoc, getDoc, deleteDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import HierarchyItemDialog, { type HierarchyItem } from './hierarchy-item-dialog';
import { deleteHierarchyItem } from '@/lib/actions/delete-hierarchy-item';

const Column = ({ title, items, selectedId, onSelect, onAdd, onEdit, onDelete, isLoading }: {
  title: string;
  items: { id: string, name: string }[] | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: () => void;
  onEdit: (id: string, name: string) => void;
  onDelete: (id: string, name: string) => void;
  isLoading: boolean;
}) => (
  <Card className="flex-1">
    <CardHeader className="flex flex-row items-center justify-between">
      <CardTitle className="text-lg">{title}</CardTitle>
      <Button size="sm" variant="outline" onClick={onAdd}><Plus className="h-4 w-4 mr-2" /> 추가</Button>
    </CardHeader>
    <CardContent>
        {isLoading ? (
            <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
            </div>
        ) : (
            <div className="flex flex-col gap-2">
                {items?.map(item => (
                <div
                    key={item.id}
                    onClick={() => onSelect(item.id)}
                    className={`flex items-center justify-between p-2 rounded-md cursor-pointer ${selectedId === item.id ? 'bg-muted' : 'hover:bg-muted/50'}`}
                >
                    <span>{item.name}</span>
                    <div className="flex gap-2">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); onEdit(item.id, item.name); }}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={(e) => { e.stopPropagation(); onDelete(item.id, item.name); }}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                </div>
                ))}
            </div>
        )}
    </CardContent>
  </Card>
);

type DialogState = {
  isOpen: boolean;
  item: HierarchyItem | null;
  type: '분야' | '큰분류' | '상세분류';
};

export default function HierarchyManager() {
  const firestore = useFirestore();
  const { toast } = useToast();

  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [selectedClassification, setSelectedClassification] = useState<string | null>(null);

  const [dialogState, setDialogState] = useState<DialogState>({ isOpen: false, item: null, type: '분야' });

  const fieldsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'fields') : null), [firestore]);
  const { data: fields, isLoading: fieldsLoading } = useCollection<Field>(fieldsQuery);

  const classificationsQuery = useMemoFirebase(() =>
    firestore && selectedField ? query(collection(firestore, 'classifications'), where('fieldId', '==', selectedField)) : null,
    [firestore, selectedField]
  );
  const { data: classifications, isLoading: classificationsLoading } = useCollection<Classification>(classificationsQuery);

  const coursesQuery = useMemoFirebase(() =>
    firestore && selectedClassification ? query(collection(firestore, 'courses'), where('classificationId', '==', selectedClassification)) : null,
    [firestore, selectedClassification]
  );
  const { data: courses, isLoading: coursesLoading } = useCollection<Course>(coursesQuery);
  
  useEffect(() => {
    if (selectedField && fields && !fields.find(f => f.id === selectedField)) {
      setSelectedField(null);
    }
  }, [fields, selectedField]);

  useEffect(() => {
    if (selectedClassification && classifications && !classifications.find(c => c.id === selectedClassification)) {
      setSelectedClassification(null);
    }
  }, [classifications, selectedClassification]);

  const handleSelectField = (id: string | null) => {
    setSelectedField(id);
    setSelectedClassification(null);
  };

  const handleSelectClassification = (id: string | null) => {
    setSelectedClassification(id);
  };

  const openDialog = (type: DialogState['type'], item: HierarchyItem | null = null) => {
    if ((type === '큰분류' && !selectedField) || (type === '상세분류' && !selectedClassification)) {
      toast({ variant: 'destructive', title: '오류', description: '상위 계층을 먼저 선택해주세요.' });
      return;
    }
    setDialogState({ isOpen: true, item, type });
  };

  const closeDialog = () => setDialogState({ isOpen: false, item: null, type: '분야' });

  const handleSave = async (item: HierarchyItem) => {
    if (!firestore) return;
    try {
      const { type, item: existingItem } = dialogState;
      let collectionName: 'fields' | 'classifications' | 'courses';

      if (type === '분야') collectionName = 'fields';
      else if (type === '큰분류') collectionName = 'classifications';
      else collectionName = 'courses';

      if (existingItem) { // Edit mode
        await updateDoc(doc(firestore, collectionName, existingItem.id), { name: item.name });
        toast({ title: '수정 성공', description: `${type} '${item.name}'이(가) 수정되었습니다.` });
      } else { // Add mode
        let data: any = { name: item.name };
        if (type === '큰분류' && selectedField) {
          data.fieldId = selectedField;
           data.prices = { day1: 0, day30: 0, day60: 0, day90: 0 };
           data.description = "새로운 분류입니다.";
        } else if (type === '상세분류' && selectedClassification) {
          data.classificationId = selectedClassification;
          data.description = "새로운 강좌입니다.";
          data.thumbnailUrl = "https://picsum.photos/seed/default/600/400";
          data.thumbnailHint = "placeholder";
        }
        await addDoc(collection(firestore, collectionName), data);
        toast({ title: '추가 성공', description: `${type} '${item.name}'이(가) 추가되었습니다.` });
      }
    } catch (error) {
      console.error("Error saving document: ", error);
      toast({ variant: 'destructive', title: '저장 실패', description: '항목 저장 중 오류가 발생했습니다.' });
    } finally {
      closeDialog();
    }
  };
  
  const handleDelete = async (collectionName: 'fields' | 'classifications' | 'courses', id: string, name: string) => {
    if (!firestore) return;
    if (!confirm(`정말로 '${name}' 항목을 삭제하시겠습니까? 하위 항목이 있는 경우 서버 액션을 통해 함께 삭제됩니다.`)) return;

    // --- Start: 완전 디버깅 모드 ---
    console.log("--- DELETE ATTEMPT (DEBUG MODE) ---");
    console.log("Project ID:", firestore.app.options.projectId);
    console.log("Target Collection Name:", collectionName);
    console.log("Target Document ID:", id);

    const docRef = doc(firestore, collectionName, id);

    try {
        console.log("Step 1: Checking if document exists at path:", docRef.path);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            console.log("Step 2: Document FOUND. Data:", docSnap.data());
            
            // Check for subcollections before deciding deletion strategy
            const isField = collectionName === 'fields';
            const isClassification = collectionName === 'classifications';
            
            // Fields and Classifications have sub-items, so they need the robust server-side deletion.
            if (isField || isClassification) {
                console.log("Step 3: This is a parent item. Using server action for safe recursive deletion.");
                const result = await deleteHierarchyItem(collectionName, id);
                if (result.success) {
                    toast({ title: '서버 액션 성공', description: result.message });
                    if (collectionName === 'fields' && selectedField === id) setSelectedField(null);
                    if (collectionName === 'classifications' && selectedClassification === id) setSelectedClassification(null);
                } else {
                    throw new Error(result.message);
                }
            } else { // 'courses' are leaf nodes in this manager, can be deleted directly or via server action. Let's use server action for consistency.
                console.log("Step 3: This is a course. Using server action to also delete episodes and files.");
                const result = await deleteHierarchyItem(collectionName, id);
                 if (result.success) {
                    toast({ title: '서버 액션 성공', description: result.message });
                } else {
                    throw new Error(result.message);
                }
            }
        } else {
            console.error("Step 2: Document NOT FOUND at the specified path. Aborting delete.");
            toast({
                variant: "destructive",
                title: "삭제 실패",
                description: "삭제할 문서를 찾을 수 없습니다. 경로가 잘못되었을 수 있습니다.",
            });
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error("--- DELETE FAILED ---", error);
        toast({
            variant: "destructive",
            title: "삭제 중 오류 발생",
            description: errorMessage,
        });
    } finally {
        console.log("--- DELETE ATTEMPT FINISHED ---");
    }
    // --- End: 완전 디버깅 모드 ---
  };


  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>계층 구조 관리</CardTitle>
          <p className="text-sm text-muted-foreground">분야 &gt; 큰분류 &gt; 상세분류 순서로 콘텐츠 계층을 관리합니다.</p>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4">
            <Column
              title="분야 (Field)"
              items={fields}
              selectedId={selectedField}
              onSelect={handleSelectField}
              onAdd={() => openDialog('분야')}
              onEdit={(id, name) => openDialog('분야', { id, name })}
              onDelete={(id, name) => handleDelete('fields', id, name)}
              isLoading={fieldsLoading}
            />
            <Column
              title="큰분류 (Classification)"
              items={classifications}
              selectedId={selectedClassification}
              onSelect={handleSelectClassification}
              onAdd={() => openDialog('큰분류')}
              onEdit={(id, name) => openDialog('큰분류', { id, name })}
              onDelete={(id, name) => handleDelete('classifications', id, name)}
              isLoading={!selectedField || classificationsLoading}
            />
            <Column
              title="상세분류 (Course)"
              items={courses}
              selectedId={null} // Courses are leaf nodes in this view
              onSelect={() => {}}
              onAdd={() => openDialog('상세분류')}
              onEdit={(id, name) => openDialog('상세분류', { id, name })}
              onDelete={(id, name) => handleDelete('courses', id, name)}
              isLoading={!selectedClassification || coursesLoading}
            />
          </div>
        </CardContent>
      </Card>
      {dialogState.isOpen && (
        <HierarchyItemDialog
          isOpen={dialogState.isOpen}
          onClose={closeDialog}
          onSave={handleSave}
          item={dialogState.item}
          itemType={dialogState.type}
        />
      )}
    </>
  );
}

    